/**
 * Provisions-/Produktlogik — einzige gemeinsame Quelle für Extension (dieses
 * File, direkt als Content-Script geladen, siehe manifest.json) und CRM
 * (`src/lib/utils.ts` importiert diese Datei direkt statt eine eigene Kopie
 * zu pflegen). Kein Build-Schritt für die Extension nötig: reines UMD-artiges
 * Script, das sich per `globalThis` (Browser) oder `module.exports` (Node/
 * Vite) exportiert.
 *
 * @typedef {import("../../src/types").ProductInfo} ProductInfo
 * @typedef {import("../../src/types").Settings} Settings
 * @typedef {import("../../src/types").Contract} Contract
 * @typedef {import("../../src/types").TariffChange} TariffChange
 */
(function () {
  "use strict";

  /**
   * @param {Settings} settings
   * @param {string} productName
   * @returns {number}
   */
  function getProductCommission(settings, productName) {
    const products = (settings && settings.products) || [];
    const match = products.find((p) => p && p.name === productName);
    return (match && Number(match.commission)) || 0;
  }

  /**
   * @param {Pick<Contract, "products" | "status">} contract
   * @param {Settings} settings
   * @returns {number}
   */
  function calcContractCommission(contract, settings) {
    if (!contract || contract.status === "storniert") return 0;
    const products = Array.isArray(contract.products) ? contract.products : [];
    return products.reduce((sum, p) => sum + getProductCommission(settings, p), 0);
  }

  /**
   * @param {Pick<TariffChange, "changeType" | "context">} change
   * @param {Settings} settings
   * @returns {number}
   */
  function calcTariffCommission(change, settings) {
    const matrix = (settings && settings.tariffCommission) || {};
    const byType = change && matrix[change.changeType];
    const value = byType && change && byType[change.context];
    return typeof value === "number" ? value : 0;
  }

  // Feste Kategorie-Reihenfolge, damit jeder Produkt-Picker (Extension-
  // Abschluss-Panel und CRM-Vertragsformular) immer gleich sortiert.
  const PRODUCT_CATEGORY_ORDER = ["Privat", "Business", "Zusatz"];

  /**
   * @param {ProductInfo[]} products
   * @returns {{category: string, products: ProductInfo[]}[]}
   */
  function groupProductsByCategory(products) {
    const list = Array.isArray(products) ? products : [];
    return PRODUCT_CATEGORY_ORDER.map((category) => ({
      category,
      products: list.filter((p) => p && p.category === category)
    })).filter((group) => group.products.length > 0);
  }

  const api = { getProductCommission, calcContractCommission, calcTariffCommission, groupProductsByCategory };

  // Immer global registrieren — davon lesen die Chrome-Extension (klassisches
  // Script) UND der Vite-Dev-Server/Vitest (natives ESM per Seiteneffekt-
  // Import, siehe src/lib/utils.ts: dort funktioniert kein echter
  // `export default`, weil dieselbe Datei auch als Nicht-Modul-Script laufen
  // muss). Zusätzlich, falls vorhanden, auch module.exports setzen (Node
  // `require()` in den Extension-Tests) — beide Zweige schließen sich nicht
  // aus, unterschiedliche Umgebungen brauchen unterschiedliche der beiden Formen.
  globalThis.StadtnetzCRM = globalThis.StadtnetzCRM || {};
  globalThis.StadtnetzCRM.commission = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
