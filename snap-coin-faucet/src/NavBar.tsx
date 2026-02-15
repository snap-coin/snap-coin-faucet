"use client";

export default function NavBar() {
  return (
    <>
      <div className="fixed top-0 w-full p-3 z-1000">
        <div className="p-2 flex items-center justify-between backdrop-blur-sm rounded-xl border border-neutral-700">
          <a className="flex items-center gap-2" href="/">
            <img src="/logo.svg" alt="Logo" height={50} width={50} />
            <h2 className="text-nowrap text-xl hidden md:block">
              <span className="font-bold">Snap Coin</span> Faucet
            </h2>
          </a>
          <a href="https://snap-coin.net" className="p-3 cursor-pointer hover:underline">Go Home</a>
        </div>
      </div>

      <div className="mb-15"></div>
    </>
  );
}
