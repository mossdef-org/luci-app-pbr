// Copyright 2022 Stan Grishin <stangri@melmac.ca>
// This code wouldn't have been possible without help from [@vsviridov](https://github.com/vsviridov)

"use strict";
"require form";
"require rpc";
"require view";
"require dom";
"require pbr.status as pbr";
/* global pbr */

var pkg = pbr.pkg;

// ─── pbr-ui overlay: exec order, groups, filters, clone ──────────────
// Policies are never reordered: UCI order is execution order, and the
// always-visible Exec # makes that order explicit. Filtering dims
// non-matching rows instead of hiding or moving them. All text lands in
// the DOM via E()/textContent, never via innerHTML.

var GROUP_PALETTE = [
	"#2d5986", "#1a6644", "#7a3a1a", "#5a2d86", "#1a5a6a", "#863d2d",
	"#4a5d23", "#7a1a44",
];

// Stable color per label (hash-based, order-independent).
function groupColor(label) {
	var h = 0;
	for (var i = 0; i < label.length; i++)
		h = (h * 31 + label.charCodeAt(i)) >>> 0;
	return GROUP_PALETTE[h % GROUP_PALETTE.length];
}

var PBR_UI_CSS = [
	"#pbr-filter-bar { display:flex; flex-wrap:wrap; gap:6px; align-items:center;",
	"  padding:8px 0; }",
	"#pbr-filter-bar .pbr-bar-label { font-size:.85em; opacity:.7; margin-right:2px; }",
	".pbr-chip { cursor:pointer; user-select:none; border-radius:12px; padding:2px 11px;",
	"  font-size:.85em; line-height:1.6; border:1px solid rgba(128,128,128,.45);",
	"  background:rgba(128,128,128,.12); white-space:nowrap; }",
	".pbr-chip:hover { border-color:rgba(128,128,128,.8); }",
	".pbr-chip.active { color:#fff; border-color:transparent; }",
	".pbr-chip .pbr-chip-n { opacity:.65; font-size:.9em; margin-left:4px; }",
	".pbr-dim { opacity:.3; }",
	".pbr-exec-num { display:inline-block; min-width:1.6em; margin-right:6px;",
	"  font-size:.78em; opacity:.55; text-align:right; font-variant-numeric:tabular-nums; }",
	".pbr-group-badge { display:inline-block; color:#fff; border-radius:3px;",
	"  padding:0 6px; margin-right:6px; font-size:.75em; line-height:1.7;",
	"  vertical-align:middle; letter-spacing:.04em; }",
	".pbr-clone-btn { margin:0 2px; }",
	"#pbr-grp-actions { display:flex; gap:5px; margin-left:8px; }",
	".pbr-hits-badge { display:inline-block; margin-left:6px; padding:0 7px;",
	"  border-radius:8px; font-size:.75em; line-height:1.7;",
	"  background:rgba(128,128,128,.18); opacity:.85;",
	"  font-variant-numeric:tabular-nums; vertical-align:middle; }",
	".pbr-hits-badge.pbr-hits-active { background:rgba(26,102,68,.85); color:#fff; }",
	"tr.pbr-grp-hdr td { cursor:pointer; user-select:none; padding:3px 10px !important;",
	"  color:#fff; font-weight:600; font-size:.8em; letter-spacing:.06em; line-height:1.9; }",
	"tr.pbr-grp-hdr td:hover { filter:brightness(1.12); }",
	".pbr-grp-hits { display:inline-block; margin-left:8px; padding:0 7px;",
	"  border-radius:8px; font-size:.85em; font-weight:400; line-height:1.6;",
	"  background:rgba(255,255,255,.22); color:#fff;",
	"  font-variant-numeric:tabular-nums; }",
	".pbr-grp-hits.pbr-hits-active { background:rgba(255,255,255,.38); font-weight:600; }",
	".pbr-toggle { display:inline-block; width:1.1em; }",
	".pbr-count { opacity:.75; font-weight:400; margin-left:.4em; }",
	".pbr-hdr-right { float:right; display:flex; gap:4px; }",
	".pbr-hdr-btn { cursor:pointer; background:rgba(255,255,255,.2);",
	"  border:1px solid rgba(255,255,255,.3); color:#fff; padding:0 8px;",
	"  border-radius:3px; font-size:.95em; line-height:1.6; white-space:nowrap; }",
	".pbr-hdr-btn:hover { background:rgba(255,255,255,.38); }",
].join("\n");

function ensureCSS() {
	if (document.getElementById("pbr-ui-css")) return;
	var st = document.createElement("style");
	st.id = "pbr-ui-css";
	st.textContent = PBR_UI_CSS;
	document.head.appendChild(st);
}

// Transient view state; survives map re-renders, resets on page load.
var uiFilter = { group: null, iface: null };

function renumberRows(sectNode) {
	Array.from(sectNode.querySelectorAll("tr[data-sid]")).forEach(
		function (row, i) {
			var n = row.querySelector(".pbr-exec-num");
			if (n) n.textContent = String(i + 1);
		}
	);
}

function applyFilter(rows) {
	rows.forEach(function (row) {
		var dim =
			(uiFilter.group && row.dataset.pbrGroup !== uiFilter.group) ||
			(uiFilter.iface && row.dataset.pbrIface !== uiFilter.iface);
		row.classList.toggle("pbr-dim", !!dim);
	});
}

function buildFilterBar(sectNode, m, sPolicy, groups, ifaces) {
	var old = sectNode.querySelector("#pbr-filter-bar");
	if (old) old.remove();

	var rows = Array.from(sectNode.querySelectorAll("tr[data-sid]"));
	var bar = E("div", { "id": "pbr-filter-bar" });

	function chip(label, count, color, isActive, onClick) {
		return E("span", {
			"class": "pbr-chip" + (isActive ? " active" : ""),
			"style": isActive ? "background:" + color : null,
			"click": onClick,
		}, [label, E("span", { "class": "pbr-chip-n" }, String(count))]);
	}

	var ifaceNames = Object.keys(ifaces).sort();
	if (ifaceNames.length) {
		bar.appendChild(E("span", { "class": "pbr-bar-label" }, _("Interface") + ":"));
		ifaceNames.forEach(function (ifc) {
			bar.appendChild(chip(ifc, ifaces[ifc], "#555d68",
				uiFilter.iface === ifc, function () {
					uiFilter.iface = uiFilter.iface === ifc ? null : ifc;
					buildFilterBar(sectNode, m, sPolicy, groups, ifaces);
					applyFilter(rows);
				}));
		});
	}

	var groupNames = Object.keys(groups).sort();
	if (groupNames.length)
		bar.appendChild(E("span", { "class": "pbr-bar-label" }, _("Group") + ":"));
	groupNames.forEach(function (g) {
		bar.appendChild(chip(g, groups[g].sids.length, groupColor(g),
			uiFilter.group === g, function () {
				uiFilter.group = uiFilter.group === g ? null : g;
				buildFilterBar(sectNode, m, sPolicy, groups, ifaces);
				applyFilter(rows);
			}));
	});

	if (uiFilter.group && groups[uiFilter.group]) {
		var g = uiFilter.group;
		var sids = groups[g].sids;
		var act = E("div", { "id": "pbr-grp-actions" });

		act.appendChild(E("button", {
			"class": "btn cbi-button cbi-button-add",
			"title": _("Add a policy to this group"),
			"click": function (ev) {
				ev.preventDefault();
				var nsid = m.data.add(pkg.Name, "policy");
				m.data.set(pkg.Name, nsid, "group", g);
				m.data.set(pkg.Name, nsid, "enabled", "1");
				sPolicy.addedSection = nsid;
				sPolicy.renderMoreOptionsModal(nsid);
			},
		}, "+ " + _("Rule")));

		act.appendChild(E("button", {
			"class": "btn cbi-button cbi-button-neutral",
			"title": _("Remove the group label, keep the policies"),
			"click": function (ev) {
				ev.preventDefault();
				if (!window.confirm(_("Remove group \"%s\" from %d policies?")
						.format(g, sids.length))) return;
				sids.forEach(function (sid) {
					m.data.unset(pkg.Name, sid, "group");
				});
				uiFilter.group = null;
				m.save(null, true);
			},
		}, "⟲ " + _("Ungroup")));

		act.appendChild(E("button", {
			"class": "btn cbi-button cbi-button-negative",
			"title": _("Delete the group and all its policies"),
			"click": function (ev) {
				ev.preventDefault();
				if (!window.confirm(
					_("Delete group \"%s\" and ALL its %d policies? This cannot be undone.")
						.format(g, sids.length))) return;
				sids.forEach(function (sid) {
					m.data.remove(pkg.Name, sid);
				});
				uiFilter.group = null;
				m.save(null, true);
			},
		}, "✕ " + _("Delete all")));

		bar.appendChild(act);
	}

	if (uiFilter.group || uiFilter.iface) {
		bar.appendChild(E("span", {
			"class": "pbr-chip",
			"click": function () {
				uiFilter.group = uiFilter.iface = null;
				buildFilterBar(sectNode, m, sPolicy, groups, ifaces);
				applyFilter(rows);
			},
		}, "✕ " + _("Reset filters")));
	}

	var descr = sectNode.querySelector(".cbi-section-descr");
	if (descr) descr.insertAdjacentElement("afterend", bar);
	else sectNode.insertBefore(bar, sectNode.firstChild);
}

// ── Per-policy live hit badges (needs pbr nft_rule_counter='1') ──────

var callPolicyHits = rpc.declare({
	object: "luci.pbr",
	method: "getPolicyHits",
});

function decorateHits(sectNode) {
	callPolicyHits().then(function (res) {
		var countersOn = !!(res && res.counters);
		var hits = (res && res.hits) || {};
		Array.from(sectNode.querySelectorAll("tr[data-sid]")).forEach(
			function (row) {
				var sid = row.getAttribute("data-sid");
				var sec = L.uci.get(pkg.Name, sid) || {};
				var nameCell = row.querySelector('[data-name="name"]');
				if (!nameCell) return;
				var badge = nameCell.querySelector(".pbr-hits-badge");
				if (!countersOn || !sec.name || !(sec.name in hits)) {
					if (badge) badge.remove();
					return;
				}
				var val = hits[sec.name];
				if (!badge) {
					badge = E("span", {
						"class": "pbr-hits-badge",
						"title": _("Packets matched (live nft counters)"),
					});
					nameCell.appendChild(badge);
				}
				badge.textContent = String(val);
				badge.classList.toggle("pbr-hits-active", val > 0);
			}
		);
		// group headers: sum of hits over the policies of each header's block
		Array.from(sectNode.querySelectorAll("tr.pbr-grp-hdr")).forEach(
			function (hdr) {
				var badge = hdr.querySelector(".pbr-grp-hits");
				if (!countersOn) {
					if (badge) badge.remove();
					return;
				}
				var sum = 0;
				var any = false;
				var n = hdr.nextElementSibling;
				while (n && n.hasAttribute("data-sid") &&
					n.dataset.pbrGroup === hdr.dataset.pbrGroup) {
					var sec = L.uci.get(pkg.Name,
						n.getAttribute("data-sid")) || {};
					if (sec.name && (sec.name in hits)) {
						sum += hits[sec.name];
						any = true;
					}
					n = n.nextElementSibling;
				}
				if (!any) {
					if (badge) badge.remove();
					return;
				}
				if (!badge) {
					badge = E("span", {
						"class": "pbr-grp-hits",
						"title": _("Total packets matched by this block"),
					});
					var cnt = hdr.querySelector(".pbr-count");
					if (cnt) cnt.insertAdjacentElement("afterend", badge);
					else hdr.querySelector("td").appendChild(badge);
				}
				badge.textContent = sum + " " + _("hits");
				badge.classList.toggle("pbr-hits-active", sum > 0);
			});

		// refresh while this render is still on screen
		if (sectNode.isConnected !== false)
			window.setTimeout(function () { decorateHits(sectNode); }, 10000);
	}).catch(function () { /* module not installed — no badges */ });
}

// ── Group header rows: collapse/expand, move, clone ──────────────────
// Headers are built per CONTIGUOUS RUN of the same group label in real
// UCI order, so visual order always equals execution order. Collapsing
// only hides rows; moving/cloning are explicit bulk reorders staged via
// uci and applied with the usual Save & Apply (pbr restart).

var LS_COLLAPSED = "pbr-ui-collapsed";

function loadCollapsed() {
	try {
		return new Set(JSON.parse(localStorage.getItem(LS_COLLAPSED) || "[]"));
	} catch (e) { return new Set(); }
}

function saveCollapsed(set) {
	try {
		localStorage.setItem(LS_COLLAPSED, JSON.stringify(Array.from(set)));
	} catch (e) { /* ignore */ }
}

function getRuns(rows) {
	var runs = [];
	var cur = null;
	rows.forEach(function (row) {
		var g = row.dataset.pbrGroup || "";
		if (!cur || cur.label !== g) {
			cur = { label: g, rows: [], sids: [] };
			runs.push(cur);
		}
		cur.rows.push(row);
		cur.sids.push(row.getAttribute("data-sid"));
	});
	return runs;
}

// Bulk structural ops go through the uci layer + a full page reload:
// Map.save() on current LuCI silently drops 'reorder' changes, and a
// structural change is cleaner re-rendered from scratch anyway. The
// staged changes then await the regular Save & Apply (pbr restart).

// Place run's sections, keeping their internal order, before targetSid.
function moveRunBefore(run, targetSid) {
	L.uci.move(pkg.Name, run.sids[0], targetSid, false);
	for (var k = 1; k < run.sids.length; k++)
		L.uci.move(pkg.Name, run.sids[k], run.sids[k - 1], true);
	return L.uci.save().then(function () { window.location.reload(); });
}

// Duplicate a whole run right after itself under a fresh "<label>-copy" name.
function cloneRun(run, allLabels) {
	var base = run.label + "-copy";
	var lbl = base;
	var n = 2;
	while (allLabels.indexOf(lbl) !== -1) lbl = base + n++;
	var anchor = run.sids[run.sids.length - 1];
	run.sids.forEach(function (sid) {
		var src = L.uci.get(pkg.Name, sid) || {};
		var nsid = L.uci.add(pkg.Name, "policy");
		Object.keys(src).forEach(function (k) {
			if (k.charAt(0) !== ".")
				L.uci.set(pkg.Name, nsid, k, src[k]);
		});
		L.uci.set(pkg.Name, nsid, "group", lbl);
		L.uci.move(pkg.Name, nsid, anchor, true);
		anchor = nsid;
	});
	return L.uci.save().then(function () { window.location.reload(); });
}

function injectGroupHeaders(sectNode, m, rows) {
	Array.from(sectNode.querySelectorAll("tr.pbr-grp-hdr")).forEach(
		function (h) { h.remove(); });
	if (!rows.length) return;

	var collapsed = loadCollapsed();
	var runs = getRuns(rows);
	var allLabels = [];
	runs.forEach(function (r) {
		if (r.label && allLabels.indexOf(r.label) === -1)
			allLabels.push(r.label);
	});
	var colCount = rows[0].children.length;

	var applyCollapse = function () {
		rows.forEach(function (row) {
			var g = row.dataset.pbrGroup || "";
			row.style.display = (g && collapsed.has(g)) ? "none" : "";
		});
		Array.from(sectNode.querySelectorAll("tr.pbr-grp-hdr")).forEach(
			function (h) {
				var t = h.querySelector(".pbr-toggle");
				if (t) t.textContent =
					collapsed.has(h.dataset.pbrGroup) ? "▶" : "▼";
			});
	};

	runs.forEach(function (run, idx) {
		if (!run.label) return;

		var btn = function (txt, title, fn) {
			return E("button", {
				"class": "pbr-hdr-btn",
				"title": title,
				"click": function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
					fn();
				},
			}, txt);
		};

		var right = E("span", { "class": "pbr-hdr-right" }, [
			idx > 0 ? btn("▲", _("Move group up"), function () {
				moveRunBefore(run, runs[idx - 1].sids[0]);
			}) : "",
			idx < runs.length - 1 ? btn("▼", _("Move group down"), function () {
				moveRunBefore(runs[idx + 1], run.sids[0]);
			}) : "",
			btn("⧉ " + _("Clone"), _("Duplicate this group with all its policies"),
				function () { cloneRun(run, allLabels); }),
		]);

		var cell = E("td", {
			"style": "background:" + groupColor(run.label),
		}, [
			E("span", { "class": "pbr-toggle" },
				collapsed.has(run.label) ? "▶" : "▼"),
			" ",
			E("strong", {}, run.label),
			E("span", { "class": "pbr-count" },
				"(" + run.rows.length + ")"),
			right,
		]);
		cell.colSpan = colCount;
		cell.addEventListener("click", function () {
			if (collapsed.has(run.label)) collapsed.delete(run.label);
			else collapsed.add(run.label);
			saveCollapsed(collapsed);
			applyCollapse();
		});

		var hdr = E("tr", { "class": "pbr-grp-hdr" }, cell);
		hdr.dataset.pbrGroup = run.label;
		hdr.draggable = false;
		run.rows[0].parentNode.insertBefore(hdr, run.rows[0]);
	});

	applyCollapse();
}

function setupPolicyUI(formNode, m, sPolicy) {
	ensureCSS();

	var sectNode = formNode.querySelector("#cbi-pbr-policy");
	if (!sectNode) return;

	// Re-apply the overlay after every map re-render (inline flag toggles,
	// modal saves, our own group actions) without reloading the page.
	if (!m._pbrUiWrapped) {
		m._pbrUiWrapped = true;
		var origSave = m.save.bind(m);
		m.save = function () {
			return origSave.apply(null, arguments).then(function (res) {
				setupPolicyUI(formNode, m, sPolicy);
				return res;
			});
		};
	}

	// Keep Exec # correct while rows are drag-sorted.
	if (!sectNode.dataset.pbrDndHooked) {
		sectNode.dataset.pbrDndHooked = "1";
		["drop", "dragend"].forEach(function (evName) {
			sectNode.addEventListener(evName, function () {
				window.setTimeout(function () { renumberRows(sectNode); }, 50);
			}, true);
		});
	}

	var rows = Array.from(sectNode.querySelectorAll("tr[data-sid]"));
	var groups = {};
	var ifaces = {};

	rows.forEach(function (row, idx) {
		var sid = row.getAttribute("data-sid");
		var sec = L.uci.get(pkg.Name, sid) || {};
		var g = (sec.group || "").trim();
		var ifc = (sec.interface || "").trim();

		row.dataset.pbrGroup = g;
		row.dataset.pbrIface = ifc;
		if (g) (groups[g] = groups[g] || { sids: [] }).sids.push(sid);
		if (ifc) ifaces[ifc] = (ifaces[ifc] || 0) + 1;

		var firstCell = row.querySelector("td");
		if (firstCell && !firstCell.querySelector(".pbr-exec-num"))
			firstCell.insertBefore(
				E("span", { "class": "pbr-exec-num" }, String(idx + 1)),
				firstCell.firstChild
			);

		if (g) {
			row.style.borderLeft = "3px solid " + groupColor(g);
			var nameCell = row.querySelector('[data-name="name"]');
			if (nameCell && !nameCell.querySelector(".pbr-group-badge"))
				nameCell.insertBefore(
					E("span", {
						"class": "pbr-group-badge",
						"style": "background:" + groupColor(g),
					}, g),
					nameCell.firstChild
				);
		} else {
			row.style.borderLeft = "";
		}

		var tdLast = row.querySelector("td:last-child");
		var actions = tdLast ? (tdLast.querySelector("div") || tdLast) : null;
		if (actions && !tdLast.querySelector(".pbr-clone-btn")) {
			actions.insertBefore(
				E("button", {
					"class": "btn cbi-button cbi-button-neutral pbr-clone-btn",
					"title": _("Duplicate this policy"),
					"click": function (ev) {
						ev.preventDefault();
						ev.stopPropagation();
						var src = L.uci.get(pkg.Name, sid) || {};
						var nsid = m.data.add(pkg.Name, "policy");
						Object.keys(src).forEach(function (k) {
							if (k.charAt(0) !== ".")
								m.data.set(pkg.Name, nsid, k, src[k]);
						});
						m.data.set(pkg.Name, nsid, "name",
							src.name ? src.name + "-copy" : "copy");
						return m.save(null, true);
					},
				}, _("Clone")),
				actions.querySelector(".cbi-button-edit")
			);
		}
	});

	injectGroupHeaders(sectNode, m, rows);
	buildFilterBar(sectNode, m, sPolicy, groups, ifaces);
	applyFilter(rows);
	decorateHits(sectNode);
}

// ─── end pbr-ui overlay ──────────────────────────────────────────────

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(pbr.getInitStatus(pkg.Name), {}),
			L.resolveDefault(L.uci.load(pkg.Name), {}),
		]);
	},

	render: function (data) {
		var status, m, s, o;
		var statusData = (data[0] && data[0][pkg.Name]) || {};
		var reply = {
			interfaces: statusData.interfaces || ["wan"],
			interface_labels: statusData.interface_labels || {},
			// An empty list leaves the Protocol dropdown with nothing but 'all',
			// since usableProtos filters it. tcp/udp are the only two certain to
			// be in /etc/protocols, and they also yield the 'tcp udp' composite.
			// Tested with .length, not ||, because an empty array is truthy and
			// pbr returns one if /etc/protocols cannot be read.
			protocols: statusData.protocols?.length
				? statusData.protocols
				: ["tcp", "udp"],
			platform: statusData.platform || {
				nft_installed: false,
				adguardhome_installed: false,
				dnsmasq_installed: false,
				unbound_installed: false,
				dnsmasq_nftset_support: false,
			},
		};

		status = new pbr.status();
		m = new form.Map(pkg.Name, _("Policy Based Routing - Configuration"));

		s = m.section(form.NamedSection, "config", pkg.Name);
		s.tab("tab_basic", _("Basic Configuration"));
		s.tab(
			"tab_advanced",
			_("Advanced Configuration"),
			_(
				"%sWARNING:%s Please make sure to check the %sREADME%s before changing anything in this section! " +
					"Change any of the settings below with extreme caution!%s"
			).format(
				"<br/>&#160;&#160;&#160;&#160;<b>",
				"</b>",
				'<a href="' +
					pkg.URL +
					'#service-configuration-settings" target="_blank">',
				"</a>",
				"<br/><br/>"
			)
		);

		o = s.taboption(
			"tab_basic",
			form.ListValue,
			"verbosity",
			_("Output verbosity"),
			_("Controls both system log and console output verbosity.")
		);
		o.value("0", _("Suppress/No output"));
		o.value("1", _("Condensed output"));
		o.value("2", _("Verbose output"));
		o.default = "2";

		o = s.taboption(
			"tab_basic",
			form.ListValue,
			"strict_enforcement",
			_("Strict enforcement"),
			_("See the %sREADME%s for details.").format(
				'<a href="' + pkg.URL + '#strict-enforcement" target="_blank">',
				"</a>"
			)
		);
		o.value("0", _("Do not enforce policies when their gateway is down"));
		o.value("1", _("Strictly enforce policies when their gateway is down"));
		o.default = "1";

		var text = "";
		if (reply.platform.dnsmasq_nftset_support === null) {
			text +=
				_("The %s support is unknown.").format("<i>dnsmasq.nftset</i>") +
				"<br />";
		} else if (!reply.platform.dnsmasq_nftset_support) {
			text +=
				_("The %s is not supported on this system.").format(
					"<i>dnsmasq.nftset</i>"
				) + "<br />";
		}
		text += _(
			"Please check the %sREADME%s before changing this option."
		).format(
			'<a href="' + pkg.URL + '#use-resolvers-set-support" target="_blank">',
			"</a>"
		);

		o = s.taboption(
			"tab_basic",
			form.ListValue,
			"resolver_set",
			_("Use resolver set support for domains"),
			text
		);
		o.value("none", _("Disabled"));
		o.default = "none";
		if (reply.platform.dnsmasq_nftset_support) {
			o.value("dnsmasq.nftset", _("Dnsmasq nft set"));
			o.default = "dnsmasq.nftset";
		} else if (
			L.uci.get(pkg.Name, "config", "resolver_set") === "dnsmasq.nftset"
		) {
			// Support detection can fail transiently, for instance when dnsmasq
			// is not installed or not yet running. Without the stored value in
			// the choice list the select falls back to its first entry and
			// saving would silently rewrite resolver_set to "none". The
			// description above already states that support is missing.
			o.value("dnsmasq.nftset", _("Dnsmasq nft set"));
		}
		// luci-base 974b5864e05e removes options whose value equals their
		// default. pbr provisions resolver_set in /etc/config/pbr and in
		// uci-defaults, so without this the stored dnsmasq.nftset would be
		// deleted on the first Save and nft set handling silently disabled.
		o.rmempty = false;

		o = s.taboption(
			"tab_basic",
			form.ListValue,
			"ipv6_enabled",
			_("IPv6 Support")
		);
		o.value("0", _("Disabled"));
		o.value("1", _("Enabled"));

		o = s.taboption(
			"tab_advanced",
			form.DynamicList,
			"supported_interface",
			_("Supported Interfaces"),
			_(
				"Allows to specify the list of interface names to be explicitly supported by the service. " +
					"Can be useful if your OpenVPN tunnels have dev option other than tun* or tap* or specific use cases " +
					"of WireGuard servers. See the %sREADME%s for details."
			).format(
				'<a href="' + pkg.URL + '#wireguard-server-use-cases" target="_blank">',
				"</a>"
			)
		);
		o.optional = false;

		o = s.taboption(
			"tab_advanced",
			form.DynamicList,
			"ignored_interface",
			_("Ignored Interfaces"),
			_(
				"Allows to specify the list of interface names to be ignored by the service. " +
					"Can be useful for an OpenVPN server running on OpenWrt device. WireGuard servers, which " +
					"have a listen_port defined, are handled automatically, do not add those here." +
					"See the %sREADME%s for details."
			).format(
				'<a href="' + pkg.URL + '#wireguard-server-use-cases" target="_blank">',
				"</a>"
			)
		);
		o.optional = false;

		o = s.taboption(
			"tab_advanced",
			form.ListValue,
			"icmp_interface",
			_("Default ICMP Interface"),
			_("Force the ICMP protocol interface.")
		);
		o.value("", _("No Change"));
		reply.interfaces.forEach((element) => {
			if (element.toLowerCase() !== "ignore") {
				o.value(element, reply.interface_labels[element] || element);
			}
		});
		o.rmempty = true;

		o = s.taboption(
			"tab_advanced",
			form.Value,
			"uplink_interface",
			_("Default Uplink Interface (IPv4)"),
			_("Force the default IPv4 uplink interface used by the service. " +
				"Select from the list of known interfaces or enter a custom interface name.")
		);
		if (Array.isArray(reply.interfaces)) {
			reply.interfaces.forEach((element) => {
				if (element.toLowerCase() !== "ignore") {
					o.value(element, reply.interface_labels[element] || element);
				}
			});
		}
		o.datatype = "network";
		o.default = "wan";
		// Keeps the default visible in /etc/config/pbr. luci-base 974b5864e05e
		// removes values equal to the default and made forcewrite unreachable
		// in exactly that case, so rmempty is what forces the write now.
		o.rmempty = false;

		o = s.taboption(
			"tab_advanced",
			form.Value,
			"uplink_interface6",
			_("Default Uplink Interface (IPv6)"),
			_("Force the default IPv6 uplink interface used by the service. " +
				"Select from the list of known interfaces or enter a custom interface name.")
		);
		if (Array.isArray(reply.interfaces)) {
			reply.interfaces.forEach((element) => {
				if (element.toLowerCase() !== "ignore") {
					o.value(element, reply.interface_labels[element] || element);
				}
			});
		}
		o.datatype = "network";
		o.default = "wan6";
		// See uplink_interface above.
		o.rmempty = false;
		o.depends("ipv6_enabled", "1");

		o = s.taboption(
			"tab_advanced",
			form.Value,
			"uplink_mark",
			_("Uplink Interface Table FW Mark"),
			_(
				"Starting (Uplink Interface) FW Mark for marks used by the service. High starting mark is " +
					"used to avoid conflict with SQM/QoS. Change with caution together with"
			) +
				" " +
				_("Service FW Mask") +
				"."
		);
		o.rmempty = true;
		o.placeholder = "010000";
		o.datatype = "hexstring";

		o = s.taboption(
			"tab_advanced",
			form.Value,
			"fw_mask",
			_("Service FW Mask"),
			_(
				"FW Mask used by the service. High mask is used to avoid conflict with SQM/QoS. " +
					"Change with caution together with"
			) +
				" " +
				_("WAN Table FW Mark") +
				"."
		);
		o.rmempty = true;
		o.placeholder = "ff0000";
		o.datatype = "hexstring";

		o = s.taboption(
			"tab_advanced",
			form.Value,
			"uplink_ip_rules_priority",
			_("Uplink IP Rules Priority"),
			_(
				"Starting (Uplink/WAN) ip rules priority used by the pbr service. High starting priority is " +
					"used to avoid conflict with other services, this can be changed by user."
			)
		);
		o.rmempty = true;
		o.placeholder = "30000";
		o.datatype = "range(99,32765)";
		o.default = "30000";

		s = m.section(
			form.GridSection,
			"policy",
			_("Policies"),
			_(
				"Name, interface and at least one other field are required. Multiple local and remote " +
					"addresses/devices/domains and ports can be space separated. Placeholders below represent just " +
					"the format/syntax and will not be used if fields are left blank. For more information on options, check the %sREADME%s."
			).format(
				'<a href="' + pkg.URL + '#policy-options" target="_blank">',
				"</a>"
			)
		);
		s.rowcolors = true;
		s.sortable = true;
		s.anonymous = true;
		s.addremove = true;

		o = s.option(form.Flag, "enabled", _("Enabled"));
		o.default = "1";
		o.editable = true;

		o = s.option(form.Value, "name", _("Name"));

		// pbr-ui: free-form label used only by the WebUI to badge and filter
		// policies; the service ignores it and never reorders anything.
		o = s.option(form.Value, "group", _("Group"));
		o.rmempty = true;
		o.optional = true;
		o.modalonly = true;
		L.uci.sections(pkg.Name, "policy", function (sec) {
			if (sec.group) o.value(sec.group);
		});

		o = s.option(form.Value, "src_addr", _("Local addresses / devices"));
		o.datatype =
			"list(neg(or(cidr,host,ipmask,ipaddr,macaddr,network,string)))";
		o.rmempty = true;
		o.default = "";

		o = s.option(form.Value, "src_port", _("Local ports"));
		o.datatype = "list(neg(or(portrange,port)))";
		o.placeholder = "0-65535";
		o.rmempty = true;
		o.default = "";

		o = s.option(form.Value, "dest_addr", _("Remote addresses / domains"));
		o.datatype =
			"list(neg(or(cidr,host,ipmask,ipaddr,macaddr,network,string)))";
		o.rmempty = true;
		o.default = "";

		o = s.option(form.Value, "dest_port", _("Remote ports"));
		o.datatype = "list(neg(or(portrange,port)))";
		o.placeholder = "0-65535";
		o.rmempty = true;
		o.default = "";

		o = s.option(form.ListValue, "proto", _("Protocol"));
		o.value("", _("all"));
		o.default = "";
		// 'proto' only ever reaches a rule as a prefix on sport/dport, so a
		// protocol that cannot carry a port cannot work here: with a port it
		// emits e.g. 'icmp dport { 53 }', which nft refuses -- rejecting the
		// whole ruleset -- and without one it is dropped and the policy matches
		// every protocol. reply.protocols is built from /etc/protocols, so most
		// of what it lists is unusable; offer only what nft can actually match.
		// To route ICMP use "Default ICMP Interface" on the Advanced tab.
		var portCapable = ["tcp", "udp", "sctp", "dccp", "udplite"];
		var usableProtos = reply.protocols.filter(function (p) {
			return portCapable.indexOf(p) !== -1;
		});
		// "tcp udp" is a composite value, not a protocol: pbr splits proto on
		// whitespace and emits one rule per token, and it is by far the most
		// common pairing, so it stays as a single convenient choice.
		var popularProtos = ["tcp", "udp", "tcp udp"];
		// Every value actually offered, so the fallback below can tell whether a
		// configured value is still in the list. Added in the same place as
		// o.value() so the two cannot drift apart.
		var offered = [""];
		function offer(p, label) {
			if (offered.indexOf(p) !== -1) return false;
			label ? o.value(p, label) : o.value(p);
			offered.push(p);
			return true;
		}
		var hasPopular = false;
		popularProtos.forEach(function (p) {
			if (p === "tcp udp") {
				if (usableProtos.indexOf("tcp") !== -1 && usableProtos.indexOf("udp") !== -1) {
					if (offer(p)) hasPopular = true;
				}
			} else if (usableProtos.indexOf(p) !== -1) {
				if (offer(p)) hasPopular = true;
			}
		});
		var hasOther = false;
		usableProtos.forEach(function (p) {
			if (popularProtos.indexOf(p) === -1) {
				if (offer(p)) hasOther = true;
			}
		});
		// Keep whatever an existing config already holds, even though it is no
		// longer offered -- otherwise opening this page silently rewrites the
		// policy to 'all' on the next save, changing what it matches.
		L.uci.sections(pkg.Name, "policy", function (sec) {
			var cur = sec.proto;
			if (cur) offer(cur, cur + " " + _("(unsupported)"));
		});
		o.rmempty = true;
		if (hasPopular && hasOther) {
			var _protoRenderWidget = o.renderWidget;
			o.renderWidget = function () {
				var node = _protoRenderWidget.apply(this, arguments);
				var sel = node.querySelector ? node.querySelector("select") : null;
				if (!sel && node.nodeName === "SELECT") sel = node;
				if (sel) {
					var lastOpt = null;
					sel.querySelectorAll("option").forEach(function (opt) {
						if (popularProtos.indexOf(opt.value) !== -1)
							lastOpt = opt;
					});
					if (lastOpt && lastOpt.nextElementSibling) {
						sel.insertBefore(
							E("option", { "disabled": "", "style": "text-align:center" },
								"── " + _("All Protocols") + " ──"),
							lastOpt.nextSibling
						);
					}
				}
				var ul = node.querySelector ? node.querySelector("ul") : null;
				if (ul) {
					var lastLi = null;
					ul.querySelectorAll("li[data-value]").forEach(function (li) {
						if (popularProtos.indexOf(li.getAttribute("data-value")) !== -1)
							lastLi = li;
					});
					if (lastLi && lastLi.nextElementSibling) {
						lastLi.parentNode.insertBefore(
							E("li", {
								"unselectable": "",
								"style": "text-align:center;opacity:0.6;font-size:90%"
							}, "── " + _("All Protocols") + " ──"),
							lastLi.nextSibling
						);
					}
				}
				return node;
			};
		}

		o = s.option(form.ListValue, "chain", _("Chain"));
		o.value("", "prerouting");
		o.value("forward", "forward");
		o.value("output", "output");
		o.default = "";
		o.rmempty = true;

		o = s.option(form.ListValue, "interface", _("Interface"));
		reply.interfaces.forEach((element) => {
			o.value(element, reply.interface_labels[element] || element);
		});
		o.datatype = "network";
		o.rmempty = false;

		var sPolicy = s; // pbr-ui: kept for the post-render overlay

		s = m.section(
			form.GridSection,
			"dns_policy",
			_("DNS Policies"),
			_(
				"Name, local address and remote DNS fields are required. Multiple local " +
					"addresses/devices can be space separated. For more information on options, check the %sREADME%s."
			).format(
				'<a href="' + pkg.URL + '#dns-policy-options" target="_blank">',
				"</a>"
			)
		);
		s.rowcolors = true;
		s.sortable = true;
		s.anonymous = true;
		s.addremove = true;

		o = s.option(form.Flag, "enabled", _("Enabled"));
		o.default = "1";
		o.editable = true;

		o = s.option(form.Value, "name", _("Name"));
		o.optional = false;

		o = s.option(form.Value, "src_addr", _("Local addresses / devices"));
		o.optional = false;
		o.datatype =
			"list(neg(or(cidr,host,ipmask,ipaddr,macaddr,network,string)))";
		o.rmempty = true;
		o.default = "";

		o = s.option(form.Value, "dest_dns", _("Remote DNS"));
		o.optional = false;
		o.rmempty = false;
		o.datatype = "list(or(cidr,host,network,ipaddr))";
		reply.interfaces.forEach((element) => {
			element === "ignore" || o.value(element, reply.interface_labels[element] || element);
		});

		o = s.option(form.Value, "dest_dns_port", _("Remote DNS Port"));
		o.optional = true;
		o.rmempty = true;
		o.datatype = "port";
		o.default = "53";

		s = m.section(
			form.NamedSection,
			"config",
			pkg.Name,
			_("DSCP Tagging"),
			_(
				"Set DSCP tags (in range between 1 and 63) for specific interfaces. See the %sREADME%s for details."
			).format(
				'<a href="' + pkg.URL + "#dscp-tag-based-policies" + '" target="_blank">',
				"</a>"
			)
		);
		reply.interfaces.forEach((element) => {
			if (element.toLowerCase() !== "ignore") {
				o = s.option(
					form.Value,
					element + "_dscp",
					element.toUpperCase() + " " + _("DSCP Tag")
				);
				o.datatype = "and(uinteger, min(1), max(63))";
			}
		});

		s = m.section(
			form.GridSection,
			"include",
			_("Custom User File Includes"),
			_(
				"Run the following user files after setting up but before restarting DNSMASQ. " +
					"See the %sREADME%s for details."
			).format(
				'<a href="' + pkg.URL + '#custom-user-files" target="_blank">',
				"</a>"
			)
		);
		s.sortable = true;
		s.anonymous = true;
		s.addremove = true;

		o = s.option(form.Flag, "enabled", _("Enabled"));
		o.optional = false;
		o.editable = true;
		o.rmempty = false;

		o = s.option(form.Value, "path", _("Path"));
		o.optional = false;
		o.editable = true;
		o.rmempty = false;

		return Promise.all([status.render(), m.render()]).then(function (nodes) {
			var statusNode = nodes[0];

			// pbr-ui overlay: exec numbers, group badges, filter bar, clone
			setupPolicyUI(nodes[1], m, sPolicy);

			// Saving settings fires pbr's procd config.change trigger, which
			// reloads the service asynchronously. LuCI reloads the page once the
			// apply completes, so getInitStatus() often lands mid-reload and
			// reports state that is already out of date -- and nothing ever
			// re-checks it. Nothing in this app registers a poll, so whatever is
			// on screen after that first fetch stays there until the user
			// refreshes by hand.
			//
			// Two ways that shows up. A service caught mid-restart reads as
			// stopped and stays "Stopped". And -- since r97 reports a policy's
			// 'proto' and rejects an unusable chain -- a warning the user has
			// just corrected stays on screen, because the reload never makes the
			// service look stopped, so the old check (enabled && !running) never
			// armed for it.
			//
			// So arm whenever there is something that could still change: the
			// service is not running yet, or the status carries messages that a
			// reload may be about to revise.
			//
			// This deliberately uses setTimeout rather than LuCI's poll module
			// (same approach as pollServiceStatus() in pbr/status.js): a
			// registered poll drives LuCI's global auto-refresh indicator, which
			// would sit at "Paused" once we unregistered, as if the page had
			// stalled.
			var hasMessages = function (reply) {
				return (
					((reply.errors || []).length > 0) ||
					((reply.warnings || []).length > 0)
				);
			};

			// Everything the status box shows that a config change can alter.
			// Comparing it across ticks lets us stop as soon as the service has
			// settled, instead of guessing how long a reload takes -- a large
			// config can take the better part of a minute.
			var stateSignature = function (reply) {
				// Sorted, so a reload that reports the same messages in a
				// different order counts as settled instead of flip-flopping
				// until the attempt limit. The order pbr emits them in follows
				// its policy processing and is not something the panel depends
				// on.
				var codes = function (list) {
					return (list || [])
						.map(function (m) {
							return m.code + "\u0000" + m.info;
						})
						.sort();
				};
				return JSON.stringify([
					!!reply.running,
					!!reply.enabled,
					codes(reply.errors),
					codes(reply.warnings),
				]);
			};

			if (statusData.enabled && (!statusData.running || hasMessages(statusData))) {
				var attempts = 0;
				var maxAttempts = 22; // give up after ~90s
				var initialSig = stateSignature(statusData);
				// Deliberately NOT seeded with initialSig. This loop only runs
				// when the page already looks unsettled, so pairing the first
				// poll with the page-load read ends it at attempts == 1 whenever
				// a reload is still in flight -- the common case -- leaving the
				// mid-restart status on screen. Two POLLED reads must agree.
				var lastSig = null;

				// Check quickly at first, since a reload normally completes
				// within a few seconds, then ease off so that a slow restart
				// doesn't hammer an RPC this expensive -- and doesn't compete
				// for CPU with the very reload we're waiting on.
				var delayFor = function (done) {
					if (done < 4) return 1500;
					if (done < 8) return 3000;
					return 5000;
				};

				// Re-render only once the state settles, so the service control
				// buttons inside the status box aren't torn out from under the
				// user on every tick.
				var refreshStatus = function () {
					return status.render().then(function (freshNode) {
						if (statusNode.isConnected === false) return;
						dom.content(
							statusNode,
							Array.prototype.slice.call(freshNode.childNodes)
						);
					});
				};

				var checkStatus = function () {
					// Stop if the user has navigated away: LuCI replaces the
					// view but pending timers keep running, and getInitStatus()
					// is expensive enough that polling a page nobody is looking
					// at is worth avoiding. Written as `=== false` so a browser
					// without isConnected simply behaves as before.
					if (statusNode.isConnected === false) return;

					attempts++;
					L.resolveDefault(pbr.getInitStatus(pkg.Name), {})
						.then(function (res) {
							var reply = (res && res[pkg.Name]) || {};
							var sig = stateSignature(reply);

							// Settled once two consecutive reads agree, or we
							// have waited long enough.
							if (sig === lastSig || attempts >= maxAttempts) {
								// Only redraw if what is on screen is actually
								// out of date. A service sitting on a permanent
								// warning therefore costs two RPCs per page load
								// and no redraw at all.
								if (sig !== initialSig) return refreshStatus();
								return;
							}

							lastSig = sig;
							setTimeout(checkStatus, delayFor(attempts));
						})
						.catch(function () {
							if (attempts < maxAttempts)
								setTimeout(checkStatus, delayFor(attempts));
						});
				};

				setTimeout(checkStatus, delayFor(0));
			}

			return nodes;
		});
	},
});
