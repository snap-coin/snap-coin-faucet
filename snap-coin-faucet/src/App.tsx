import HCaptcha from "@hcaptcha/react-hcaptcha";
import { BACKEND, CAPTCHA_KEY } from "./utils";
import NavBar from "./NavBar";
import { Droplets, Ghost } from "lucide-react";
import { useEffect, useState } from "react";
import CodeBox from "./CodeBox";

function PopUp({ onDone }: { onDone: (token: string, ekey: string) => void }) {
  return (
    <div className="fixed z-100 inset-0 flex items-center justify-center p-10 overflow-x-hidden">
      <HCaptcha
        sitekey={CAPTCHA_KEY}
        onVerify={(token, ekey) => onDone(token, ekey)}
      />
    </div>
  );
}

function App() {
  const [testing, setTesting] = useState(false);
  const [faucetInfo, setFaucetInfo] = useState<{
    wallet: string;
    balance: number;
    drop: number;
  }>();
  const [wallet, setWallet] = useState(
    () => localStorage.getItem("wallet") ?? "",
  );
  const [ongoing, setOngoing] =
    useState<{ status: string; transaction_id: string }[]>();

  function refreshOngoing() {
    fetch(BACKEND + "/get-withdrawals/" + wallet)
      .then((res) => res.json())
      .then((o) => setOngoing(o));
  }

  useEffect(() => {
    refreshOngoing();

    (async () => {
      const balance = Number(
        await fetch(BACKEND + "/faucet-balance").then((res) => res.text()),
      );
      const drop = Number(
        await fetch(BACKEND + "/faucet-drop").then((res) => res.text()),
      );
      const wallet = await fetch(BACKEND + "/faucet-wallet").then((res) =>
        res.text(),
      );

      setFaucetInfo({ wallet, balance, drop });
    })();

    const iid = setInterval(refreshOngoing, 10000);
    return () => {
      clearInterval(iid);
    };
  }, []);

  const [captchaKeys, setCaptchaKeys] = useState<{
    token: string;
    ekey: string;
  } | null>(null);

  function onWithdrawal() {
    fetch(BACKEND + "/withdraw-faucet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        wallet,
        captcha: captchaKeys?.token,
      }),
    }).then((res) => {
      if (res.ok) {
        refreshOngoing();
      }
    });
  }

  return (
    <>
      <NavBar />
      {testing && (
        <PopUp
          onDone={(token, ekey) => {
            setTesting(false);
            setCaptchaKeys({ token, ekey });
          }}
        />
      )}
      <div className="hidden md:flex flex-col items-center gap-5 mt-50">
        <div className="flex gap-3 items-center">
          <p className="text-3xl">Snap Coin</p>
          <h1 className="font-extrabold text-3xl">Faucet</h1>
          <Droplets className="h-full" size={100} />
        </div>
      </div>

      <div className="p-30 px-5 sm:px-50 flex flex-col items-center">
        <div className="max-w-200 w-full flex flex-col gap-5">
          <h1 className="text-2xl font-bold">Faucet</h1>
          <p>
            Obtain some free <b>SNAP</b> to try out the <b>network</b>, its
            free! No strings attached! Learn how to use Snap Coin at{" "}
            <a
              className="hover:underline text-accent-dark"
              href="https://snap-coin.net"
            >
              snap-coin.net
            </a>
          </p>
          {faucetInfo && (
            <div className="flex flex-col gap-5 p-5 rounded-xl border border-neutral-700 divide-y divide-neutral-700">
              <p className="pb-5">
                Faucet Balance:{" "}
                <span className="font-extrabold font-mono">
                  {faucetInfo.balance.toFixed(4)}{" "}
                  <span className="text-accent-light">SNAP</span>
                </span>
              </p>
              <div>
                <p className="mb-2">
                  <span className="font-bold">Donate</span> to the faucet:
                </p>
                <CodeBox code={faucetInfo.wallet} lang="address" />
              </div>
            </div>
          )}
          <h1 className="text-2xl font-bold">
            Withdraw{" "}
            <span className="font-extrabold font-mono">
              {faucetInfo?.drop.toFixed(4)}{" "}
              <span className="text-accent-light">SNAP</span>
            </span>
          </h1>
          <input
            placeholder="Your Snap Coin Address"
            className="font-mono font-light"
            value={wallet}
            onChange={(e) => {
              setWallet(e.target.value);
              localStorage.setItem("wallet", e.target.value);
            }}
          ></input>
          {captchaKeys == null ? (
            <button onClick={() => setTesting(true)}>
              <span className="flex items-center w-full gap-5 justify-center">
                Prove you are human
                <Ghost />
              </span>
            </button>
          ) : (
            <button
              disabled={captchaKeys == null}
              onClick={() => {
                onWithdrawal();
                setCaptchaKeys(null);
              }}
            >
              <span>
                Withdraw{" "}
                <span className="font-extrabold font-mono">
                  {faucetInfo?.drop} SNAP
                </span>
              </span>
            </button>
          )}

          <h1 className="text-2xl font-bold mt-10">Your Ongoing Withdrawals</h1>
          {ongoing ? (
            <div className="flex flex-col gap-5">
              {ongoing.map((w) => (
                <div
                  className="flex items-center justify-between gap-5 min-w-0 font-bold"
                  key={w.transaction_id}
                >
                  {w.status == "pending" ? (
                    <p className="flex-1 overflow-x-clip text-ellipsis text-nowrap min-w-0">
                      Transaction:{" "}
                      <span className="font-mono font-extralight">
                        {w.transaction_id}
                      </span>
                    </p>
                  ) : (
                    <a
                      className="hover:underline cursor-pointer flex-1 overflow-x-clip text-ellipsis text-nowrap min-w-0"
                      href={
                        "https://explorer.snap-coin.net/tx/" + w.transaction_id
                      }
                    >
                      Transaction:{" "}
                      <span className="font-mono font-extralight">
                        {w.transaction_id}
                      </span>
                    </a>
                  )}
                  <p className="font-extrabold font-mono">
                    {w.status.toUpperCase()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-neutral-400">No withdrawals yet</p>
          )}
        </div>
      </div>
    </>
  );
}

export default App;
