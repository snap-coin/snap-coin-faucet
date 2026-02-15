use axum::{
    Json, Router,
    extract::{ConnectInfo, Path, State},
    http::StatusCode,
    routing::{get, post},
};
use dotenv::dotenv;
use serde::{Deserialize, Serialize};
use snap_coin::{
    api::client::Client,
    blockchain_data_provider::BlockchainDataProvider,
    core::transaction::{MAX_TRANSACTION_IO, Transaction, TransactionInput, TransactionOutput},
    crypto::keys::{Private, Public},
    to_nano, to_snap,
};
use snap_coin_pay::{
    chain_interaction::ApiChainInteraction,
    withdrawal_payment_processor::{
        OnWithdrawalConfirmation, WithdrawalId, WithdrawalPaymentProcessor, WithdrawalStatus,
    },
};
use std::{
    collections::{HashMap, HashSet},
    env,
    net::SocketAddr,
    sync::{Arc, atomic::AtomicU64},
    time::Duration,
};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

type OngoingWithdrawals = Arc<RwLock<HashMap<Public, HashSet<WithdrawalId>>>>;

#[derive(Clone)]
struct AppState {
    ongoing_withdrawals: OngoingWithdrawals,
    withdrawal_processor: Arc<WithdrawalPaymentProcessor<ApiChainInteraction>>,
    faucet_private: Private,
    faucet_drop: u64,
}

#[derive(Clone)]
struct OnConfirmation {
    ongoing_withdrawals: OngoingWithdrawals,
    withdrawal_processor: Arc<WithdrawalPaymentProcessor<ApiChainInteraction>>,
}

#[async_trait::async_trait]
impl OnWithdrawalConfirmation for OnConfirmation {
    async fn on_confirmation(&self, withdrawal_id: WithdrawalId, _tx: Transaction) {
        // Stop tracking this withdrawal
        {
            let mut map = self.ongoing_withdrawals.write().await;
            let keys_to_remove: Vec<Public> = map
                .iter_mut()
                .filter_map(|(public, withdrawals)| {
                    if withdrawals.remove(&withdrawal_id) {
                        if withdrawals.is_empty() {
                            Some(public.clone())
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                })
                .collect();

            for key in keys_to_remove {
                map.remove(&key);
            }
        }

        self.withdrawal_processor
            .untrack_withdrawal(withdrawal_id)
            .await;
    }
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    dotenv().ok();
    let node_api: SocketAddr = env::var("NODE_API")?.parse()?;
    let faucet_private = Private::new_from_base36(&env::var("FAUCET_PRIVATE")?).unwrap();
    let faucet_drop: u64 = to_nano(env::var("FAUCET_DROP")?.parse()?);

    let ongoing_withdrawals: OngoingWithdrawals = Arc::new(RwLock::new(HashMap::new()));

    let chain_interface = ApiChainInteraction::new(node_api).await?;
    let withdrawal_processor = WithdrawalPaymentProcessor::new(chain_interface);

    let on_confirmation = OnConfirmation {
        withdrawal_processor: withdrawal_processor.clone(),
        ongoing_withdrawals: ongoing_withdrawals.clone(),
    };

    withdrawal_processor.start(10, on_confirmation).await?;

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .allow_credentials(false);

    let latest_balance = Arc::new(AtomicU64::new(0));

    let latest_balance_mut = latest_balance.clone();
    tokio::spawn(async move {
        let client = Client::connect(node_api).await.unwrap();

        loop {
            if let Err(e) = async {
                latest_balance_mut.store(
                    client.get_balance(faucet_private.to_public()).await?,
                    std::sync::atomic::Ordering::SeqCst,
                );

                let available = client
                    .get_available_transaction_outputs(faucet_private.to_public())
                    .await?;

                let mut pending_outputs = vec![];
                for (tx_id, tx_out, tx_index) in available {
                    if tx_out.amount > faucet_drop {
                        pending_outputs.push((tx_id, tx_out, tx_index));
                    }
                }

                for (tx_id, tx_out, tx_index) in pending_outputs {
                    let mut outputs = vec![
                        TransactionOutput {
                            receiver: faucet_private.to_public(),
                            amount: faucet_drop
                        };
                        (tx_out.amount as usize / faucet_drop as usize)
                            .min(MAX_TRANSACTION_IO - 2)
                    ];

                    if tx_out.amount > outputs.len() as u64 * faucet_drop {
                        outputs.push(TransactionOutput {
                            amount: tx_out.amount - (outputs.len() as u64 * faucet_drop),
                            receiver: faucet_private.to_public(),
                        });
                    }

                    let mut tx = Transaction::new_transaction_now(
                        vec![TransactionInput {
                            transaction_id: tx_id,
                            output_index: tx_index,
                            signature: None,
                            output_owner: faucet_private.to_public(),
                        }],
                        outputs,
                        &mut vec![faucet_private],
                    )?;

                    tx.compute_pow(&client.get_live_transaction_difficulty().await?, Some(0.1))?;

                    client.submit_transaction(tx).await??;
                }

                Ok::<(), anyhow::Error>(())
            }
            .await
            {
                eprintln!("UTXO management loop failed: {e}");
            }
            tokio::time::sleep(Duration::from_secs(120)).await;
        }
    });

    let app = Router::new()
        .route("/withdraw-faucet", post(withdraw_faucet))
        .route(
            "/faucet-drop",
            get(move || async move { to_snap(faucet_drop).to_string() }),
        )
        .route(
            "/faucet-balance",
            get(move || async move {
                to_snap(latest_balance.load(std::sync::atomic::Ordering::SeqCst)).to_string()
            }),
        )
        .route(
            "/faucet-wallet",
            get(move || async move { faucet_private.to_public().dump_base36() }),
        )
        .route("/get-withdrawals/{wallet}", get(get_withdrawals))
        .with_state(AppState {
            ongoing_withdrawals,
            withdrawal_processor,
            faucet_private,
            faucet_drop,
        })
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:4000").await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();

    Ok(())
}

#[derive(Deserialize)]
struct FaucetWithdrawalRequest {
    wallet: String,
    captcha: String, // hCaptcha token from frontend
}

#[derive(Deserialize)]
struct HCaptchaResponse {
    success: bool,
    #[serde(default)]
    #[serde(rename = "error-codes")]
    error_codes: Vec<String>,
    #[serde(default)]
    #[allow(unused)]
    #[allow(dead_code)]
    challenge_ts: String,
    #[serde(default)]
    #[allow(unused)]
    #[allow(dead_code)]
    hostname: String,
}

async fn withdraw_faucet(
    State(state): State<AppState>,
    ConnectInfo(client_ip): ConnectInfo<SocketAddr>,
    Json(payload): Json<FaucetWithdrawalRequest>,
) -> Result<(), StatusCode> {
    // Validate hCaptcha
    let captcha_secret = std::env::var("CAPTCHA").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.hcaptcha.com/siteverify")
        .form(&[
            ("secret", &captcha_secret),
            ("response", &payload.captcha),
            ("remoteip", &client_ip.ip().to_string()),
        ])
        .send()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let captcha_resp: HCaptchaResponse = resp
        .json()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !captcha_resp.success {
        eprintln!("hCaptcha failed: {:?}", captcha_resp.error_codes);
        return Err(StatusCode::FORBIDDEN);
    }

    let wallet = match Public::new_from_base36(&payload.wallet) {
        Some(w) => w,
        None => return Err(StatusCode::BAD_REQUEST),
    };

    match state
        .withdrawal_processor
        .submit_withdrawal(vec![(wallet, state.faucet_drop)], state.faucet_private)
        .await
    {
        Ok(withdrawal_id) => {
            state
                .ongoing_withdrawals
                .write()
                .await
                .entry(wallet)
                .or_insert_with(HashSet::new)
                .insert(withdrawal_id);
        }
        Err(e) => {
            eprintln!("Failed withdrawal: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    Ok(())
}

#[derive(Serialize)]
struct Withdrawal {
    status: String,
    transaction_id: String,
}

async fn get_withdrawals(
    Path(wallet): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Vec<Withdrawal>>, StatusCode> {
    let wallet = match Public::new_from_base36(&wallet) {
        Some(w) => w,
        None => return Err(StatusCode::BAD_REQUEST),
    };

    let mut withdrawals = vec![];

    for w_id in state
        .ongoing_withdrawals
        .read()
        .await
        .get(&wallet)
        .unwrap_or(&HashSet::new())
    {
        if let Some(withdrawal) = state
            .withdrawal_processor
            .get_withdrawal_status(*w_id)
            .await
        {
            let status = match withdrawal {
                WithdrawalStatus::Pending { transaction } => ("pending", transaction),
                WithdrawalStatus::Confirmed { transaction } => ("confirmed", transaction),
                WithdrawalStatus::Confirming { transaction } => ("confirming", transaction),
                WithdrawalStatus::Expired { transaction } => ("expired", transaction),
            };
            withdrawals.push(Withdrawal {
                status: status.0.to_string(),
                transaction_id: status.1.dump_base36(),
            });
        }
    }

    Ok(Json(withdrawals))
}
