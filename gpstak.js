/*
 * GPSTAK Cockpit plugin — manage the Network GPS for TAK service.
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 * SPDX-License-Identifier: Apache-2.0
 */
/* global cockpit */
"use strict";

const UNIT = "gpstak.service";
const CONFIG = "/etc/default/gpstak";
const $ = (id) => document.getElementById(id);
let configText = "";

function setStatus(el, msg, ok) {
    el.textContent = msg;
    el.className = "aos-status " + (ok ? "ok" : "err");
    if (ok) setTimeout(() => { el.textContent = ""; }, 6000);
}

function getKey(text, key) {
    const m = text.match(new RegExp("^" + key + "=(.*)$", "m"));
    return m ? m[1].replace(/^["']|["']$/g, "") : "";
}

function setKey(text, key, value) {
    const re = new RegExp("^#?\\s*" + key + "=.*$", "m");
    const line = key + "=" + value;
    return re.test(text) ? text.replace(re, line) : text.replace(/\n*$/, "\n") + line + "\n";
}

function refreshState() {
    cockpit.spawn(["systemctl", "is-active", UNIT], { err: "ignore" })
        .then((o) => { $("svc-state").textContent = o.trim(); $("svc-state").className = "aos-status ok"; })
        .catch((ex) => { $("svc-state").textContent = (ex.message || "inactive").trim(); $("svc-state").className = "aos-status err"; });
    cockpit.spawn(["journalctl", "-u", UNIT, "-n", "40", "--no-pager"], { superuser: "try", err: "ignore" })
        .then((o) => { $("journal").textContent = o; })
        .catch(() => { $("journal").textContent = "(no journal access)"; });
    cockpit.spawn(["gpspipe", "-w", "-n", "8"], { err: "ignore" })
        .then((o) => {
            for (const line of o.split("\n")) {
                try {
                    const m = JSON.parse(line);
                    if (m.class === "TPV" && m.mode >= 2) {
                        $("last-fix").textContent =
                            "Current fix: " + m.lat.toFixed(6) + ", " + m.lon.toFixed(6) +
                            (m.altHAE !== undefined ? "  HAE " + m.altHAE.toFixed(1) + " m" : "");
                        return;
                    }
                } catch (e) { /* not json */ }
            }
            $("last-fix").textContent = "No GNSS fix yet (check the GPS page).";
        })
        .catch(() => { $("last-fix").textContent = ""; });
}

function svc(args) {
    cockpit.spawn(["systemctl"].concat(args), { superuser: "require", err: "message" })
        .then(refreshState)
        .catch((ex) => setStatus($("save-status"), ex.message || String(ex), false));
}

function save() {
    let next = configText;
    next = setKey(next, "COT_URL", $("cot-url").value.trim() || "udp+broadcast://255.255.255.255:4349");
    next = setKey(next, "NMEA_TARGETS", $("nmea-targets").value.trim());
    next = setKey(next, "GPSTAK_RATE", $("rate").value.trim() || "1.0");
    cockpit.file(CONFIG, { superuser: "require" }).replace(next)
        .then(() => {
            configText = next;
            return cockpit.spawn(["systemctl", "try-restart", UNIT], { superuser: "require", err: "message" });
        })
        .then(() => { setStatus($("save-status"), "Saved; service restarted.", true); refreshState(); })
        .catch((ex) => setStatus($("save-status"), "Failed: " + (ex.message || ex), false));
}

cockpit.file(CONFIG, { superuser: "try" }).watch((content) => {
    configText = content || "";
    $("cot-url").value = getKey(configText, "COT_URL");
    $("nmea-targets").value = getKey(configText, "NMEA_TARGETS");
    $("rate").value = getKey(configText, "GPSTAK_RATE");
});
$("btn-enable").addEventListener("click", () => svc(["enable", "--now", UNIT]));
$("btn-restart").addEventListener("click", () => svc(["try-restart", UNIT]));
$("btn-disable").addEventListener("click", () => svc(["disable", "--now", UNIT]));
$("btn-save").addEventListener("click", save);
refreshState();
setInterval(refreshState, 10000);
