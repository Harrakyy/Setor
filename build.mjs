// Bundle web/ → www/ (dipakai APK). `--serve` untuk uji di http://localhost:5178
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("www", { recursive: true, force: true });
await mkdir("www");
await cp("web", "www", { recursive: true, filter: (src) => !src.endsWith("app.js") });

const options = { entryPoints: ["web/app.js"], bundle: true, format: "esm", minify: true, target: "es2020", outfile: "www/app.js" };

if (process.argv.includes("--serve")) {
  const ctx = await esbuild.context(options);
  await ctx.serve({ servedir: "www", port: 5178 });
  console.log("http://localhost:5178");
  await new Promise(() => {}); // tetap hidup walau stdin tertutup
} else {
  await esbuild.build(options);
}
