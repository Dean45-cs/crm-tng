"use strict";

// Nachträgliche Ad-hoc-Signatur der fertigen macOS-App.
//
// Ohne diesen Schritt bleibt im Bundle die Signatur der ausgelieferten
// Electron-Vorlage stehen – sie beschreibt aber einen anderen Inhalt als den,
// der nach dem Einpacken drinsteht (app.asar, extension/). macOS sieht dann
// eine gebrochene Signatur, und das ist etwas anderes als gar keine: auf einem
// fremden Rechner erscheint „Die App ist beschädigt und kann nicht geöffnet
// werden", und dagegen hilft auch Rechtsklick → Öffnen nicht. Genau so stirbt
// eine Verteilung im Team, bevor sie anfängt.
//
// Eine Ad-hoc-Signatur (`--sign -`) macht daraus wieder einen ehrlichen Zustand:
// nicht von Apple beglaubigt, aber in sich stimmig. Die App startet dann nach
// einmaligem Rechtsklick → Öffnen (bzw. ohne alles, wenn die Datei nicht aus
// dem Netz kam). Eine echte Beglaubigung bräuchte ein Apple-Entwicklerkonto –
// siehe README, Abschnitt „Im Team verteilen".
//
// Läuft automatisch als afterPack-Haken von electron-builder, also vor dem
// Bauen des Installationsabbilds.

const path = require("path");
const { execFileSync } = require("child_process");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // --deep gilt als veraltet, ist für eine reine Ad-hoc-Signatur aber genau
  // richtig: es nimmt die eingebetteten Frameworks und Hilfsprogramme mit, die
  // sonst einzeln signiert werden müssten.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  console.log(`  • ad-hoc signiert  ${path.basename(appPath)}`);
};
