window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-data-mining",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/DockBar.tsx
		/** Parse the status text block into per-stage lines for chip rendering. */
		function parseStatusLines(text) {
			return text.split("\n").map((line) => line.trim()).filter((line) => /^[✅🔄⬜]/.test(line)).map((line) => ({
				icon: line[0] ?? "⬜",
				label: line.slice(2)
			}));
		}
		/**
		* The worker dock: a row of stage chips with progress lights, refreshed
		* from `/dm status`. Clicking a chip focuses the worker's session when one
		* exists (we cannot know worker sessions yet, so the chip just refreshes and
		* reports the current summary).
		*/
		function DockBar({ sessionId, refreshStatus, openSession, ..._rest }) {
			const [status, setStatus] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)(void 0);
			const refresh = async () => {
				try {
					const result = await refreshStatus();
					if (result.error !== void 0) {
						setError(result.error.message ?? "status unavailable");
						setStatus("");
					} else {
						setStatus(result.text ?? "");
						setError(void 0);
					}
				} catch (e) {
					setError(e instanceof Error ? e.message : "status unavailable");
					setStatus("");
				}
			};
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			const stages = parseStatusLines(status);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "4px 8px",
					fontSize: 12,
					borderTop: "1px solid var(--dsw-alias-border, #ddd)"
				},
				"data-plugin": "data-mining-dock",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontWeight: 600,
							marginRight: 4
						},
						children: "数据挖掘"
					}),
					error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { color: "#b3261e" },
						children: error
					}) : stages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { color: "#888" },
						children: "未开始（点此初始化 /dm status）"
					}) : stages.map((s, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						title: `${s.icon} ${s.label} — 点击刷新`,
						onClick: () => {
							refresh();
						},
						style: {
							border: "1px solid var(--dsw-alias-border, #ddd)",
							background: "transparent",
							borderRadius: 10,
							padding: "1px 8px",
							cursor: "pointer",
							fontSize: 12
						},
						children: [
							s.icon,
							" ",
							s.label
						]
					}, i)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => {
							refresh();
						},
						style: {
							marginLeft: "auto",
							background: "transparent",
							border: "none",
							cursor: "pointer",
							fontSize: 12
						},
						"aria-label": "刷新进度",
						children: "⟳"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							color: "#888",
							fontSize: 11
						},
						children: sessionId.slice(-6)
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services for the dock entry. `remote.commands` is its own
		* injection seat (as in ui-plan) — `remote` alone does not provide it. */
		const inject = [
			"slots",
			"sessions",
			"remote",
			"remote.commands"
		];
		/** Browser plugin body: the worker dock entry. */
		function apply(ctx) {
			const sessions = ctx.sessions;
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "data-mining-dock",
				order: 20,
				inject: (sessionId) => ({
					sessionId,
					refreshStatus: () => ctx.remote.commands.execute(sessionId, "/dm status"),
					openSession: (id) => sessions.open(id)
				})
			}, DockBar));
		}
		//#endregion
		exports.DockBar = DockBar;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map