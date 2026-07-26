// Copyright 2022 Stan Grishin <stangri@melmac.ca>
// This code wouldn't have been possible without help from [@vsviridov](https://github.com/vsviridov)

"use strict";
"require form";
"require rpc";
"require view";
"require pbr.status as pbr";
/* global pbr */

var pkg = pbr.pkg;

// ── Policy group UI constants ────────────────────────────────────────

var GROUP_PALETTE = [
	"#2d5986", "#1a6644", "#7a3a1a", "#5a2d86", "#1a5a6a", "#863d2d",
];

var GROUP_CSS = [
	".pbr-group-hdr { position:relative; }",
	".pbr-group-hdr td {",
	"  cursor:pointer; user-select:none;",
	"  padding:5px 12px !important;",
	"  border-top:3px solid rgba(0,0,0,.22) !important;",
	"  line-height:1.8;",
	"}",
	".pbr-group-hdr td:hover { filter:brightness(1.12); }",
	".pbr-toggle { display:inline-block; width:1.2em; text-align:center; }",
	".pbr-count  { opacity:.72; font-size:.88em; font-weight:400; margin-left:.4em; }",
	".pbr-hdr-right { float:right; display:flex; gap:5px; }",
	".pbr-hdr-btn {",
	"  cursor:pointer;",
	"  background:rgba(255,255,255,.22); border:1px solid rgba(255,255,255,.32);",
	"  color:#fff; padding:1px 9px; border-radius:3px; font-size:.82em; line-height:1.7;",
	"  white-space:nowrap;",
	"}",
	".pbr-hdr-btn:hover { background:rgba(255,255,255,.4); }",
	".pbr-add-group-bar {",
	"  display:flex; align-items:center; gap:7px; padding:6px 0 8px; flex-wrap:wrap;",
	"}",
	".pbr-add-group-bar span { font-size:.9em; opacity:.8; }",
	".pbr-add-group-bar input {",
	"  padding:3px 8px; border:1px solid #bbb; border-radius:3px;",
	"  width:155px; font-size:.9em;",
	"}",
	".pbr-add-group-bar button {",
	"  padding:3px 12px; border-radius:3px; cursor:pointer;",
	"  background:#2d5986; color:#fff; border:none; font-size:.9em;",
	"}",
	".pbr-add-group-bar button:hover { background:#3a6fa8; }",
	".pbr-clone-btn:hover { filter:brightness(.85); }",
].join("\n");

// Duplicate a policy rule: copies all UCI fields, appends -copy to name.
function cloneRule(sid) {
	const src = L.uci.get(pkg.Name, sid);
	if (!src) return;
	const newSid = L.uci.add(pkg.Name, "policy");
	Object.keys(src).forEach((k) => {
		if (k.charAt(0) !== ".") L.uci.set(pkg.Name, newSid, k, src[k]);
	});
	const origName = src.name || "";
	L.uci.set(pkg.Name, newSid, "name", origName ? origName + "-copy" : "copy");
	L.uci.save().then(() => window.location.reload());
}

// Remove group label from all rules → they fall into Ungrouped.
function dissolveGroup(groupLabel, sids) {
	if (!window.confirm(_("Remove group \"%s\" and move its %d rule(s) to Ungrouped?").format(groupLabel, sids.length))) return;
	sids.forEach((sid) => L.uci.set(pkg.Name, sid, "group", ""));
	L.uci.save().then(() => window.location.reload());
}

// Delete all rules in a group.
function deleteGroup(groupLabel, sids) {
	if (!window.confirm(_("Delete group \"%s\" and ALL %d rule(s) inside it? This cannot be undone.").format(groupLabel, sids.length))) return;
	sids.forEach((sid) => L.uci.remove(pkg.Name, sid));
	L.uci.save().then(() => window.location.reload());
}

// Click the section's built-in Add button, then pre-fill the group field.
function triggerAddRule(groupLabel, formNode) {
	const addBtn =
		formNode.querySelector(".cbi-section-create [type=submit]") ||
		formNode.querySelector(".cbi-section-create button");
	if (!addBtn) return;
	addBtn.click();
	setTimeout(() => {
		const inputs = formNode.querySelectorAll("input[id$=\".group\"]");
		if (!inputs.length) return;
		const inp = inputs[inputs.length - 1];
		inp.value = groupLabel;
		inp.dispatchEvent(new Event("input",  { bubbles: true }));
		inp.dispatchEvent(new Event("change", { bubbles: true }));
		inp.closest("tr").scrollIntoView({ behavior: "smooth", block: "nearest" });
	}, 80);
}

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
			protocols: statusData.protocols || [],
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
		if (reply.platform.dnsmasq_nftset_support) {
			o.value("dnsmasq.nftset", _("Dnsmasq nft set"));
			o.default = "dnsmasq.nftset";
		}

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
			"rule_create_option",
			_("Rule Create option"),
			_("Select Add for -A/add and Insert for -I/Insert.")
		);
		o.value("add", _("Add"));
		o.value("insert", _("Insert"));
		o.default = "add";

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
		o.datatype = "uinteger";
		o.default = "30000";

		// ── Policies ─────────────────────────────────────────────────────────

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

		// Sort rows: grouped rules first (preserving group order), ungrouped last.
		var sortedPolicySids = [];
		const _origCfg = s.cfgsections.bind(s);
		s.cfgsections = function () {
			const sids = _origCfg();
			const order = [], buckets = {}, seen = {};
			sids.forEach((sid) => {
				const g = (L.uci.get(pkg.Name, sid, "group") || "").trim();
				const k = g || "\xff";
				if (!seen[k]) { seen[k] = true; if (g) order.push(k); }
				(buckets[k] = buckets[k] || []).push(sid);
			});
			sortedPolicySids = order
				.reduce((a, k) => a.concat(buckets[k]), [])
				.concat(buckets["\xff"] || []);
			return sortedPolicySids;
		};

		o = s.option(form.Flag, "enabled", _("Enabled"));
		o.default = "1";
		o.editable = true;

		o = s.option(form.Value, "name", _("Name"));

		o = s.option(form.Value, "group", _("Group"));
		o.rmempty = true;
		o.editable = true;

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
		var popularProtos = ["tcp", "udp", "tcp udp", "icmp"];
		var hasPopular = false;
		popularProtos.forEach(function (p) {
			if (p === "tcp udp") {
				if (reply.protocols.indexOf("tcp") !== -1 && reply.protocols.indexOf("udp") !== -1) {
					o.value(p);
					hasPopular = true;
				}
			} else if (reply.protocols.indexOf(p) !== -1) {
				o.value(p);
				hasPopular = true;
			}
		});
		var hasOther = false;
		reply.protocols.forEach(function (p) {
			if (popularProtos.indexOf(p) === -1) {
				o.value(p);
				hasOther = true;
			}
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

		// ── DNS Policies ──────────────────────────────────────────────────────

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

		// ── DSCP Tagging ──────────────────────────────────────────────────────

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

		// ── Custom User File Includes ─────────────────────────────────────────

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

		// ── Post-render: inject collapsible group headers & Clone buttons ─────

		return Promise.all([status.render(), m.render()]).then((nodes) => {
			const formNode = nodes[1];

			// Inject CSS
			const styleEl = document.createElement("style");
			styleEl.textContent = GROUP_CSS;
			document.head.appendChild(styleEl);

			// localStorage persists which groups are EXPANDED (default = collapsed)
			const LS_KEY = "pbr-expanded-groups";
			let expandedSet = new Set();
			try { expandedSet = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); } catch (e) { /* ignore */ }
			const saveLS = () => {
				try { localStorage.setItem(LS_KEY, JSON.stringify([...expandedSet])); } catch (e) { /* ignore */ }
			};

			// Policy table rows
			const policyTable = formNode.querySelector("table");
			if (!policyTable) return nodes;
			const tbody = policyTable.querySelector("tbody") || policyTable;

			const dataRows = Array.from(tbody.children).filter((r) =>
				r.tagName === "TR" && !r.querySelector("th") && !r.querySelector(".cbi-section-create")
			);

			// Build group metadata and inject Clone buttons
			const groupMeta = {};
			let colorIdx = 0;

			dataRows.forEach((row, i) => {
				const sid = sortedPolicySids[i];
				if (!sid) return;
				const sec = L.uci.get(pkg.Name, sid);
				const g   = ((sec && sec.group) || "").trim();
				const lbl = g || "—";

				if (!groupMeta[lbl]) {
					groupMeta[lbl] = {
						color: g ? GROUP_PALETTE[colorIdx++ % GROUP_PALETTE.length] : "#555",
						rows: [],
						sids: [],
					};
				}
				groupMeta[lbl].rows.push(row);
				groupMeta[lbl].sids.push(sid);
				row.dataset.pbrGroup = lbl;
				row.style.borderLeft = "3px solid " + groupMeta[lbl].color;

				// Clone button: insert inside action <div>, after ☰ drag handle, before Edit
				const actionCell = row.querySelector("td:last-child");
				if (actionCell && sid) {
					const cloneBtn = document.createElement("button");
					cloneBtn.className = "pbr-clone-btn";
					cloneBtn.textContent = _("Clone");
					cloneBtn.title = _("Duplicate this rule");
					cloneBtn.style.cssText =
						"display:inline-block;padding:3px 10px;margin:0 2px;cursor:pointer;" +
						"font-size:.9em;border-radius:3px;border:1px solid #5a6268;" +
						"background:#6c757d;color:#fff;vertical-align:middle;white-space:nowrap;line-height:1.5;";
					cloneBtn.addEventListener("click", (e) => {
						e.stopPropagation();
						cloneRule(sid);
					});
					const actionsDiv = actionCell.querySelector("div");
					if (actionsDiv) {
						actionsDiv.insertBefore(cloneBtn, actionsDiv.querySelector(".cbi-button-edit") || null);
					} else {
						actionCell.insertBefore(cloneBtn, actionCell.querySelector(".cbi-button-edit") || actionCell.firstChild);
					}
				}
			});

			// Inject one collapsible header <tr> before each group's first row
			const seen = {};
			dataRows.forEach((row) => {
				const lbl = row.dataset.pbrGroup;
				if (!lbl || seen[lbl]) return;
				seen[lbl] = true;

				const color = groupMeta[lbl].color;
				let isOpen = expandedSet.has(lbl);

				const hdr  = document.createElement("tr");
				hdr.draggable = false;
				hdr.className = "pbr-group-hdr";

				const cell = document.createElement("td");
				cell.colSpan = 99;
				cell.style.cssText =
					"background:" + color + ";color:#fff;font-weight:600;" +
					"font-size:.82em;letter-spacing:.09em";
				hdr.appendChild(cell);
				tbody.insertBefore(hdr, row);

				const redraw = () => {
					const rows  = groupMeta[lbl].rows;
					const count = rows.length;
					const title = lbl === "—" ? _("Ungrouped") : lbl;
					cell.innerHTML =
						'<span class="pbr-toggle">' + (isOpen ? "▼" : "▶") + "</span> " +
						"<strong>" + title + "</strong>" +
						'<span class="pbr-count">(' + count + (count === 1 ? " " + _("rule") : " " + _("rules")) + ")</span>" +
						'<span class="pbr-hdr-right">' +
						(lbl !== "—"
							? '<button class="pbr-hdr-btn pbr-btn-add" title="' + _("Add rule to this group") + '">+ ' + _("rule") + "</button>"
							: "") +
						(lbl !== "—"
							? '<button class="pbr-hdr-btn pbr-btn-ungroup" title="' + _("Remove group label, keep rules") + '">⟲ ' + _("ungroup") + "</button>"
							: "") +
						(lbl !== "—"
							? '<button class="pbr-hdr-btn pbr-btn-delgrp" title="' + _("Delete group and all its rules") + '" style="background:rgba(180,30,30,.55);border-color:rgba(255,80,80,.4)">✕ ' + _("delete all") + "</button>"
							: "") +
						"</span>";

					rows.forEach((r) => { r.style.display = isOpen ? "" : "none"; });

					const addBtn = cell.querySelector(".pbr-btn-add");
					if (addBtn) {
						addBtn.addEventListener("click", (e) => {
							e.stopPropagation();
							triggerAddRule(lbl, formNode);
						});
					}

					const ungroupBtn = cell.querySelector(".pbr-btn-ungroup");
					if (ungroupBtn) {
						ungroupBtn.addEventListener("click", (e) => {
							e.stopPropagation();
							dissolveGroup(lbl, groupMeta[lbl].sids);
						});
					}

					const delGrpBtn = cell.querySelector(".pbr-btn-delgrp");
					if (delGrpBtn) {
						delGrpBtn.addEventListener("click", (e) => {
							e.stopPropagation();
							deleteGroup(lbl, groupMeta[lbl].sids);
						});
					}
				};

				cell.addEventListener("click", () => {
					isOpen = !isOpen;
					if (isOpen) expandedSet.add(lbl); else expandedSet.delete(lbl);
					saveLS();
					redraw();
				});

				redraw();
			});

			// "Add group" bar — positioned after the policy section description
			const bar = document.createElement("div");
			bar.className = "pbr-add-group-bar";
			bar.innerHTML =
				"<span>" + _("New group:") + "</span>" +
				'<input id="pbr-grp-in" type="text" placeholder="' + _("Group name…") + '" autocomplete="off">' +
				'<button id="pbr-grp-ok">+ ' + _("Create") + "</button>";

			const anchor =
				formNode.querySelector("#cbi-pbr-policy .cbi-section-descr") ||
				(policyTable.closest(".cbi-section") || policyTable.parentNode)
					.querySelector(".cbi-section-descr");

			if (anchor) {
				anchor.insertAdjacentElement("afterend", bar);
			} else {
				(policyTable.closest(".cbi-section") || policyTable.parentNode).prepend(bar);
			}

			bar.querySelector("#pbr-grp-ok").addEventListener("click", () => {
				const name = (bar.querySelector("#pbr-grp-in").value || "").trim();
				if (!name) return;
				const newSid = L.uci.add(pkg.Name, "policy");
				L.uci.set(pkg.Name, newSid, "group",   name);
				L.uci.set(pkg.Name, newSid, "enabled", "1");
				L.uci.save().then(() => window.location.reload());
			});

			bar.querySelector("#pbr-grp-in").addEventListener("keydown", (e) => {
				if (e.key === "Enter") bar.querySelector("#pbr-grp-ok").click();
			});

			return nodes;
		});
	},
});
