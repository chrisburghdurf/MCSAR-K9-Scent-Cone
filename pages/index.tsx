import Head from "next/head";
import LiveMap from "@/components/LiveMap";

export default function Home() {
  return (
    <>
      <Head>
        <title>K9 Scent Cone</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>

      <div className="container">
        <LiveMap />
      </div>
    </>
  );
}
