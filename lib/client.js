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
		/** The worker roster: label → preset id (created on demand by the dock). */
		const WORKERS = [{
			label: "数据理解工人",
			preset: "data-mining-understanding"
		}, {
			label: "建模工人",
			preset: "data-mining-modeling"
		}];
		function DockBar({ sessionId, getAgentPreset, refreshStatus, spawnWorker, openSession, ..._rest }) {
			const agentPreset = getAgentPreset();
			const [status, setStatus] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)(void 0);
			const [spawning, setSpawning] = (0, react.useState)(void 0);
			const spawn = async (worker) => {
				setSpawning(worker.preset);
				try {
					await spawnWorker(worker.preset);
				} catch (e) {
					setError(e instanceof Error ? e.message : `无法启动${worker.label}`);
				} finally {
					setSpawning(void 0);
				}
			};
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
				if (agentPreset === "data-mining") refresh();
			}, []);
			if (agentPreset !== "data-mining") return null;
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
					WORKERS.map((w) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						title: `打开${w.label}会话`,
						disabled: spawning !== void 0,
						onClick: () => {
							spawn(w);
						},
						style: {
							border: "1px solid var(--dsw-alias-border, #ddd)",
							background: "transparent",
							borderRadius: 10,
							padding: "1px 8px",
							cursor: "pointer",
							fontSize: 12
						},
						children: spawning === w.preset ? "启动中…" : `👷 ${w.label}`
					}, w.preset)),
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
		* injection seat (as in ui-plan) — `remote` alone does not provide it;
		* `connection` exposes the api.agentPresets remote used to apply a worker
		* preset to a fresh session. */
		const inject = [
			"slots",
			"sessions",
			"remote",
			"remote.commands",
			"connection"
		];
		/** Browser plugin body: the worker dock entry. */
		function apply(ctx) {
			const sessions = ctx.sessions;
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "data-mining-dock",
				order: 20,
				inject: (sessionId) => {
					const connection = ctx.get("connection");
					const workspaceCwd = sessions.list.byId[sessionId]?.cwd;
					return {
						sessionId,
						getAgentPreset: () => sessions.list.byId[sessionId]?.agentPreset,
						refreshStatus: () => ctx.remote.commands.execute(sessionId, "/dm status"),
						openSession: (id) => sessions.open(id),
						spawnWorker: async (workerPreset) => {
							const created = await sessions.create(workspaceCwd === void 0 ? {} : { cwd: workspaceCwd });
							const select = connection?.api?.agentPresets?.select;
							if (select !== void 0) await select({
								sessionId: created,
								agentPreset: workerPreset
							});
							sessions.open(created);
						}
					};
				}
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