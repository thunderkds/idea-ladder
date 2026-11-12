// Fails if a color literal appears in client code outside the tokens file (design-system rule from T003).
import { Glob } from "bun";

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/;
const offenders: string[] = [];
for await (const file of new Glob("src/client/**/*.{css,ts,tsx,html}").scan(".")) {
  if (file.endsWith("tokens.css")) continue;
  (await Bun.file(file).text()).split("\n").forEach((line, i) => {
    if (COLOR.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}
if (offenders.length) {
  console.error(`Color literals outside src/client/tokens.css:\n${offenders.join("\n")}`);
  process.exit(1);
}
console.log("check-tokens: 0 color literals outside src/client/tokens.css");
