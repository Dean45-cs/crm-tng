(function initJiraReader() {
  "use strict";

  const app = window.StadtnetzCRM;
  const UNKNOWN = "Nicht sichtbar";

  // Ausschließlich klassische Jira-Bereiche. Es gibt absichtlich keine Suche
  // über die komplette Seite, damit Texte aus Buttons, Menüs oder Widgets nie
  // als Ticketdaten übernommen werden.
  const SCOPE_SELECTORS = {
    details: ["#details-module", ".details-module", "[data-testid='issue.views.field-layout.group']"],
    people: ["#people-module", ".people-module", "[data-testid='issue.views.people']"]
  };

  const FIELD_DEFINITIONS = {
    priority: {
      direct: ["#priority-val", "[data-field-id='priority']"],
      labels: ["Priorität"],
      scope: "details"
    },
    status: {
      direct: ["#status-val", "[data-field-id='status']"],
      labels: ["Status"],
      scope: "details"
    },
    issueType: {
      direct: ["#type-val", "[data-field-id='issuetype']"],
      labels: ["Typ", "Vorgangstyp"],
      scope: "details"
    },
    assignee: {
      direct: ["#assignee-val", "[data-field-id='assignee']"],
      labels: ["Bearbeiter"],
      scope: "people"
    },
    reporter: {
      direct: ["#reporter-val", "[data-field-id='reporter']"],
      labels: ["Autor", "Ersteller"],
      scope: "people"
    },
    oikonomikos: {
      direct: [],
      labels: ["Oikonomikos-ID", "Oikonomikos ID"],
      scope: "details"
    }
  };

  function clean(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function cleanFieldValue(value) {
    // Das ist ein Jira-Bedienelement, kein Feldwert.
    return clean(value)
      .replace(/\bshow\s+more\s+info\b/gi, "")
      .replace(/\bhide\s+more\s+info\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function normaliseLabel(value) {
    return clean(value).replace(/:$/, "").toLocaleLowerCase("de-DE");
  }

  function isVisible(element) {
    return Boolean(element && element.getClientRects().length);
  }

  function directValue(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!isVisible(element)) continue;
      const value = cleanFieldValue(element.textContent);
      if (value) return value;
    }
    return "";
  }

  function scopesFor(scopeName) {
    const selectors = SCOPE_SELECTORS[scopeName] || [];
    const scopes = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (isVisible(element) && !scopes.includes(element)) scopes.push(element);
      });
    }
    return scopes;
  }

  function valueFromFieldRow(row, labelElement) {
    const valueElement = Array.from(row.querySelectorAll(
      "[id$='-val'], dd, .item-value, .field-value, .value"
    )).find((element) => element !== labelElement && isVisible(element) && cleanFieldValue(element.textContent));
    if (valueElement) return cleanFieldValue(valueElement.textContent);

    const siblingValue = labelElement.nextElementSibling;
    if (isVisible(siblingValue)) {
      const value = cleanFieldValue(siblingValue.textContent);
      if (value) return value;
    }

    // Fallback ausschließlich innerhalb des bereits bestätigten Feld-Eintrags.
    const labelText = clean(labelElement.textContent);
    return cleanFieldValue(clean(row.textContent).replace(labelText, ""));
  }

  function strictFieldByLabel(scopeName, labels) {
    const wanted = labels.map(normaliseLabel);
    const fieldRows = "li.item, .field-group, .field-wrap, .issue-field, tr";
    const labelSelectors = "dt, .field-label, .item-title, .name, strong";

    for (const scope of scopesFor(scopeName)) {
      // Definition-Listen (<dt>/<dd>) sind in klassischen Jira-Installationen üblich.
      for (const labelElement of scope.querySelectorAll("dt")) {
        if (!wanted.includes(normaliseLabel(labelElement.textContent))) continue;
        const value = cleanFieldValue(labelElement.nextElementSibling && labelElement.nextElementSibling.textContent);
        if (value) return value;
      }

      for (const row of scope.querySelectorAll(fieldRows)) {
        if (!isVisible(row)) continue;
        const labelElement = Array.from(row.querySelectorAll(labelSelectors)).find(
          (element) => wanted.includes(normaliseLabel(element.textContent))
        );
        if (!labelElement) continue;
        const value = valueFromFieldRow(row, labelElement);
        if (value) return value;
      }
    }
    return "";
  }

  function readField(definition) {
    return directValue(definition.direct) || strictFieldByLabel(definition.scope, definition.labels);
  }

  function ticketKey() {
    const fromUrl = window.location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
    return fromUrl ? fromUrl[1].toUpperCase() : UNKNOWN;
  }

  function description() {
    return directValue([
      "#description-val",
      "[data-field-id='description'] .user-content-block",
      "[data-field-id='description']"
    ]);
  }

  function visibleCommentBodies() {
    return Array.from(document.querySelectorAll(
      "#issue_actions_container .action-body, #activitymodule .action-body"
    )).filter(isVisible).map((element) => cleanFieldValue(element.textContent)).filter(Boolean);
  }

  function oikonomikosId(value) {
    return cleanFieldValue(value).split(/\s*\/\s*/)[0].trim();
  }

  function oikonomikosCustomerName(value) {
    // Erwartetes, im Screenshot sichtbares Format:
    // "287246 / Herr Kevin Carlsson PK"
    const parts = cleanFieldValue(value).split(/\s*\/\s*/).filter(Boolean);
    if (parts.length < 2) return "";
    return cleanFieldValue(parts[1]).replace(/\s+\b[A-ZÄÖÜ]{1,3}\b\s*$/, "").trim();
  }

  function displayReporter(value) {
    // Automatisch erzeugte Vorgänge werden bei euch von diesem Jira-Account
    // angelegt. In der UI soll dafür die verständliche Bezeichnung stehen.
    if (/ennit\s+jira\s+tools\s+administrator\s+user/i.test(value || "")) {
      return "Bot";
    }
    return value;
  }

  function read() {
    const comments = visibleCommentBodies();
    const rawOikonomikos = readField(FIELD_DEFINITIONS.oikonomikos);
    const summary = directValue([
      "#summary-val",
      "[data-testid='issue.views.issue-base.foundation.summary.heading']"
    ]);
    const ticketDescription = description();

    return {
      key: ticketKey(),
      summary: summary || UNKNOWN,
      priority: readField(FIELD_DEFINITIONS.priority) || UNKNOWN,
      status: readField(FIELD_DEFINITIONS.status) || UNKNOWN,
      issueType: readField(FIELD_DEFINITIONS.issueType) || UNKNOWN,
      customerReference: oikonomikosId(rawOikonomikos) || UNKNOWN,
      // Kundenname wird bewusst nur aus dem bestätigten Oikonomikos-Feld abgeleitet.
      // Dadurch werden keine Menü-, Link- oder Jira-Hilfstexte als Name angezeigt.
      customerName: oikonomikosCustomerName(rawOikonomikos) || UNKNOWN,
      assignee: readField(FIELD_DEFINITIONS.assignee) || UNKNOWN,
      reporter: displayReporter(readField(FIELD_DEFINITIONS.reporter)) || UNKNOWN,
      description: ticketDescription || UNKNOWN,
      latestInformation: comments[comments.length - 1] || ticketDescription || UNKNOWN,
      commentCount: comments.length,
      // Nur für die lokale Zusammenfassung im Speicher des aktuellen Tabs.
      // Diese Inhalte werden weder in Chrome Storage noch an einen Server geschrieben.
      comments: comments.slice(-12)
    };
  }

  // Nur für lokale Debug-Sessions; die UI nutzt ausschließlich read().
  app.jiraReader = { read, UNKNOWN };
})();
