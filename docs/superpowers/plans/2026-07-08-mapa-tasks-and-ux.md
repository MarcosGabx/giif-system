# Mapa Estratégico: Task System + Drawflow UX Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-node task/subtask system with badge + modal to the Drawflow strategic map, and improve Drawflow connector click-target size, hover feedback, connection visual cues, and zoom controls.

**Architecture:** All changes are confined to `index.html` (CSS and JS sections) plus a manual edit to the Gateway n8n workflow file to add one new action. Tasks are stored as `data.tasks[]` inside each Drawflow node's `data` object — no new DB tables. The badge is rendered inside the node HTML template and refreshed in-place without re-importing the map.

**Tech Stack:** Vanilla JS, SweetAlert2 (already loaded), DOMPurify (already loaded), Drawflow 0.0.60, n8n self-hosted 2.15.0 (backend).

## Global Constraints

- File: `d:\repos\repos_web_dev\vanilson-project\giif_system-main\index.html` (~5000 lines, single-file SPA)
- Gateway file: `C:\Users\marco\Downloads\GIIF - Gateway Master Update (Corrigido) (6).json` (active in production)
- JWT secret hardcoded — NEVER use `process.env` / `$env` / `$vars` in Code nodes (n8n 2.15.0 limitation)
- Gateway JWT validator node to reference: `"Validador JWT Cliente"`
- The validator already sets `item.body.usuario_id = payloadObj.usuario_id` — this prevents IDOR automatically
- SQL must use `queryReplacement` with `$1` — never string interpolation inside query
- `confirmButtonColor: '#3B55E6'`, `cancelButtonColor: '#64748b'` in all Swal dialogs
- Background in Swal: `document.documentElement.classList.contains('dark') ? '#1E1E1E' : '#fff'`
- Never call `preventDefault()` or `stopPropagation()` on the hit-area `mousedown` listener
- Drawflow data path: `mapaEditor.drawflow.drawflow.Home.data[nodeId]`
- Auto-save trigger: `mapaModificado = true; atualizarStatusMapa(); _scheduleAutoSave();`
- `postProcessMapaLinks()` is called in both `trocarMapa()` and `carregarMapas()` — this is where post-import hooks live
- Export mode CSS class: `.mapa-export-mode` — add badge show rule parallel to `.node-link-badge`
- No new tables; no new columns; no schema change; no priority; no history; no audit; no email; no global task center

---

## File Sections Touched

| Section | Lines (approx) | What changes |
|---|---|---|
| CSS — connector points | ~596–608 | Larger size, `::before` hit-area, hover scale + halo |
| CSS — connection lines | ~582–593 | Increase stroke-width for hover; add invisible thick path |
| CSS — export mode | ~860–862 | Show task badge in export |
| CSS — NEW task badge | after ~815 | `.node-task-badge` styles + colors + animation |
| CSS — NEW connecting state | after new badge CSS | `.is-connecting .input` highlight styles |
| HTML — toolbar | ~2102–2122 | Add 3 zoom buttons before status indicator |
| HTML — drawflow-container | ~2128–2130 | Add zoom overlay buttons (floating) |
| JS — globals | ~4195 area | `let _responsaveisDisponiveis = [];` |
| JS — `initMapa()` | ~4846 | Call `carregarResponsaveisDisponiveis()` after `carregarMapas()` |
| JS — `initMapa()` mousedown | ~4836 area | Add `is-connecting` class listener |
| JS — `adicionarNoMapa()` | ~4858 | Add task badge `<span>` to node HTML + `tasks:[]` to data |
| JS — `postProcessMapaLinks()` | ~4449 | Call `postProcessNodeTasks()` |
| JS — `postProcessNodeColors()` | ~4649 | No change |
| JS — `_buildCtxMenu()` | ~4467 | Add "Gerenciar Tarefas" button |
| JS — NEW functions | after `_setNodeLink` ~4644 | All new functions below |
| JS — `exportarMapaCompleto()` | no change | CSS handles badge in export |

---

## Task 1: Front B — Connector CSS Improvements

**Files:**
- Modify: `index.html` CSS section ~596–593

**What to implement:**
- Enlarge `.input` / `.output` from `14px` to `16px`
- Add `::before` pseudo-element for `-10px` hit area expansion
- Add `transition` + `transform: scale(1.6)` on hover with brand halo
- Increase `.main-path` stroke-width on hover
- Add `.is-connecting` state highlighting all `.input` elements

- [ ] **Step 1: Locate connector CSS block (line ~596)**

Find this block in index.html:
```css
/* Connector Points */
.drawflow .drawflow-node .input,
.drawflow .drawflow-node .output {
    width: 14px;
    height: 14px;
    background: #3B55E6 !important;
    border: 2.5px solid white !important;
    border-radius: 50%;
}
```

- [ ] **Step 2: Replace connector CSS with improved version**

Replace the block from `/* Connector Points */` through the closing `}` of the dark mode rule at ~608:

```css
/* Connector Points */
.drawflow .drawflow-node .input,
.drawflow .drawflow-node .output {
    width: 16px;
    height: 16px;
    background: #3B55E6 !important;
    border: 2.5px solid white !important;
    border-radius: 50%;
    position: relative;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    z-index: 1;
}

.drawflow .drawflow-node .input::before,
.drawflow .drawflow-node .output::before {
    content: "";
    position: absolute;
    inset: -10px;
    background: transparent;
    pointer-events: auto;
    border-radius: 50%;
}

.drawflow .drawflow-node .input:hover,
.drawflow .drawflow-node .output:hover {
    transform: scale(1.65);
    box-shadow: 0 0 0 6px rgba(59,85,230,0.18);
}

html.dark .drawflow .drawflow-node .input,
html.dark .drawflow .drawflow-node .output {
    border-color: #1E1E1E !important;
}

/* During active connection: highlight all inputs */
#drawflow-container.is-connecting .drawflow .drawflow-node .input {
    transform: scale(1.5);
    box-shadow: 0 0 0 5px rgba(16,185,129,0.25);
    background: #10b981 !important;
    animation: pulse-connector 1s ease-in-out infinite;
}

@keyframes pulse-connector {
    0%, 100% { box-shadow: 0 0 0 5px rgba(16,185,129,0.25); }
    50%       { box-shadow: 0 0 0 8px rgba(16,185,129,0.10); }
}
```

- [ ] **Step 3: Find and update connection line hover**

Find:
```css
.drawflow .connection .main-path:hover {
    stroke: #6366f1 !important;
}
```

Replace with:
```css
.drawflow .connection .main-path {
    stroke: #94a3b8 !important;
    stroke-width: 2.5 !important;
    cursor: pointer;
}

.drawflow .connection .main-path:hover {
    stroke: #6366f1 !important;
    stroke-width: 4 !important;
}
```

Also find the SVG path hit-area note. The Drawflow SVG paths are difficult to widen without altering Drawflow internals. Instead, add a CSS rule targeting the SVG container:

```css
/* Wider invisible hit area for connection selection — does not change visual stroke */
.drawflow .connection {
    pointer-events: visibleStroke;
}
.drawflow .connection .main-path {
    stroke-linecap: round;
}
```

- [ ] **Step 4: Manual test**
  - Open `index.html` in browser
  - Navigate to Mapa Estratégico
  - Create two nodes
  - Try connecting them — the output dot should be noticeably easier to grab
  - Hover over a connector: should see scale + halo effect
  - Try clicking on a connection line: should be easier to hit

---

## Task 2: Front B — JS Connection Feedback + Zoom Controls

**Files:**
- Modify: `index.html` JS section in `initMapa()` (~4836)
- Modify: `index.html` HTML toolbar section (~2102)

**What to implement:**
- Add `mousedown` listener on `#drawflow-container` to detect output grab, add `.is-connecting`
- Add `mouseup` on `window` to remove `.is-connecting`
- Add zoom buttons to toolbar and floating overlay
- Add `mapaZoomIn()`, `mapaZoomOut()`, `mapaZoomReset()` functions
- Add `.dragging` cursor change on node `mousedown`/`mouseup`

- [ ] **Step 1: Add zoom buttons to toolbar HTML**

Find the toolbar block (after `btn-fullscreen-mapa` around line 2106):
```html
            <button id="btn-fullscreen-mapa" onclick="toggleFullscreenMapa()"
                class="mapa-toolbar-btn border ...">
                <i class="fa-solid fa-expand"></i> Tela Cheia
            </button>
```

After that button (before `exportarMapaCompleto` button), add:
```html
            <button onclick="mapaZoomOut()" title="Zoom -"
                class="mapa-toolbar-btn border border-light-border dark:border-dark-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl px-3">
                <i class="fa-solid fa-magnifying-glass-minus"></i>
            </button>
            <button onclick="mapaZoomReset()" title="Zoom 100%"
                class="mapa-toolbar-btn border border-light-border dark:border-dark-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl px-3" id="btn-zoom-label">
                <i class="fa-solid fa-expand-arrows-alt"></i>
            </button>
            <button onclick="mapaZoomIn()" title="Zoom +"
                class="mapa-toolbar-btn border border-light-border dark:border-dark-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl px-3">
                <i class="fa-solid fa-magnifying-glass-plus"></i>
            </button>
```

- [ ] **Step 2: Add zoom JS functions**

Add these functions after `toggleMapaDropdown` (around line 4881):

```javascript
        function mapaZoomIn() {
            if (!mapaEditor) return;
            mapaEditor.zoom_in();
        }

        function mapaZoomOut() {
            if (!mapaEditor) return;
            mapaEditor.zoom_out();
        }

        function mapaZoomReset() {
            if (!mapaEditor) return;
            mapaEditor.zoom_reset();
        }
```

- [ ] **Step 3: Add is-connecting listener in initMapa()**

In `initMapa()`, after the `contextmenu` listener block (~4843), add:

```javascript
            // ── Connection drag visual feedback: highlight valid targets ──
            const dfContainer = document.getElementById('drawflow-container');
            dfContainer.addEventListener('mousedown', (e) => {
                if (e.target.closest('.output')) {
                    dfContainer.classList.add('is-connecting');
                }
            });
            window.addEventListener('mouseup', () => {
                dfContainer.classList.remove('is-connecting');
            });

            // ── Grabbing cursor during node drag ──
            dfContainer.addEventListener('mousedown', (e) => {
                const node = e.target.closest('.glass-node');
                if (node && !e.target.closest('input, textarea, button, a')) {
                    node.style.cursor = 'grabbing';
                    const stopGrab = () => {
                        node.style.cursor = '';
                        window.removeEventListener('mouseup', stopGrab);
                    };
                    window.addEventListener('mouseup', stopGrab);
                }
            });
```

- [ ] **Step 4: Manual test**
  - Click and hold an output connector — all input connectors on other nodes should pulse green
  - Release — green highlighting goes away
  - Drag a node — cursor should become `grabbing`
  - Click Zoom+, Zoom-, Reset buttons — map should zoom in/out/reset

---

## Task 3: Front A — Task Badge CSS

**Files:**
- Modify: `index.html` CSS section after `.node-link-badge` block (~816)

**What to implement:**
- `.node-task-badge` absolute-positioned badge, similar to `.node-link-badge`
- Color variants: `.ntb-neutral`, `.ntb-amber`, `.ntb-green`, `.ntb-overdue` + pulse
- Tooltip styling
- Export mode rule to show badge during PNG export
- CSS for cursor override during modal editor interaction

- [ ] **Step 1: Add task badge CSS**

After the `.node-link-badge:hover { }` block at ~815, add:

```css
        /* ── Task Badge ── */
        .node-task-badge {
            display: none;
            position: absolute;
            bottom: 6px;
            left: 6px;
            height: 20px;
            padding: 0 6px;
            border-radius: 6px;
            align-items: center;
            justify-content: center;
            gap: 3px;
            font-size: 9px;
            font-weight: 800;
            cursor: pointer;
            transition: background 0.2s, transform 0.15s;
            white-space: nowrap;
            z-index: 2;
        }
        .node-task-badge.ntb-visible {
            display: flex;
        }
        .node-task-badge.ntb-neutral {
            background: rgba(100,116,139,0.12);
            color: #64748b;
        }
        .node-task-badge.ntb-amber {
            background: rgba(245,158,11,0.12);
            color: #d97706;
        }
        .node-task-badge.ntb-green {
            background: rgba(16,185,129,0.12);
            color: #059669;
        }
        .node-task-badge.ntb-overdue {
            background: rgba(239,68,68,0.12);
            color: #dc2626;
            animation: pulse-overdue 1.4s ease-in-out infinite;
        }
        @keyframes pulse-overdue {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.55; }
        }
        .node-task-badge:hover {
            transform: scale(1.05);
        }
        /* Show badge during PNG export */
        .mapa-export-mode .node-task-badge.ntb-visible {
            display: flex !important;
            pointer-events: none;
        }
        /* Hide gear btn in export (existing rule) but keep task badge */
        .mapa-export-mode .node-gear-btn {
            display: none !important;
        }
```

- [ ] **Step 2: Manual verify**
  - No visual change yet (badge not wired) — just confirm no CSS errors in browser console

---

## Task 4: Front A — Data Layer Functions

**Files:**
- Modify: `index.html` JS section after `_setNodeLink` (~4644)

**What to implement:**
- `_getNodeTasks(nodeId)` — get tasks array (safe, default `[]`)
- `_setNodeTasks(nodeId, tasks)` — persist tasks to Drawflow data + trigger auto-save
- `_renderNodeTaskBadge(nodeId)` — compute badge state, update DOM badge element
- `postProcessNodeTasks()` — iterate all nodes, call `_renderNodeTaskBadge` for each
- Modify `postProcessMapaLinks()` to call `postProcessNodeTasks()`
- Modify `adicionarNoMapa()` to include badge HTML + `tasks: []` in data

- [ ] **Step 1: Add helper functions after `_setNodeLink` block**

After the closing `}` of `_setNodeLink` (around line 4644), add:

```javascript
        // ── TASK SYSTEM HELPERS ──

        function _getNodeTasks(nodeId) {
            return mapaEditor?.drawflow?.drawflow?.Home?.data[nodeId]?.data?.tasks || [];
        }

        function _setNodeTasks(nodeId, tasks) {
            if (!mapaEditor?.drawflow?.drawflow?.Home?.data[nodeId]) return;
            mapaEditor.drawflow.drawflow.Home.data[nodeId].data.tasks = tasks;
            mapaModificado = true;
            atualizarStatusMapa();
            _scheduleAutoSave();
        }

        function _renderNodeTaskBadge(nodeId) {
            const domNode = document.getElementById(`node-${nodeId}`);
            if (!domNode) return;
            const badge = domNode.querySelector('.node-task-badge');
            if (!badge) return;

            const tasks = _getNodeTasks(nodeId);
            const total = tasks.length;

            if (total === 0) {
                badge.className = 'node-task-badge';
                return;
            }

            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const done = tasks.filter(t => t.concluida).length;
            const hasOverdue = tasks.some(t =>
                !t.concluida && t.prazo && new Date(t.prazo + 'T00:00:00') < now
            );

            let colorClass = 'ntb-neutral';
            if (hasOverdue) {
                colorClass = 'ntb-overdue';
            } else if (done === total) {
                colorClass = 'ntb-green';
            } else if (done > 0) {
                colorClass = 'ntb-amber';
            }

            badge.className = `node-task-badge ntb-visible ${colorClass}`;
            badge.innerHTML = `<i class="fa-solid fa-list-check" style="font-size:8px"></i> ${done}/${total}`;

            // Tooltip: pending responsible names
            const pendentes = tasks
                .filter(t => !t.concluida)
                .map(t => t.responsavel_nome || 'Sem responsável')
                .filter((v, i, a) => a.indexOf(v) === i);
            badge.title = pendentes.length
                ? `Pendentes: ${pendentes.join(', ')}`
                : 'Todas concluídas';
        }

        function postProcessNodeTasks() {
            if (!mapaEditor?.drawflow?.drawflow?.Home?.data) return;
            const nodes = mapaEditor.drawflow.drawflow.Home.data;
            for (const nodeId in nodes) {
                _renderNodeTaskBadge(nodeId);
            }
        }
```

- [ ] **Step 2: Call `postProcessNodeTasks()` from `postProcessMapaLinks()`**

Find in `postProcessMapaLinks()`:
```javascript
            // Restaura cores dos nós após import
            postProcessNodeColors();
```

Replace with:
```javascript
            // Restaura cores dos nós após import
            postProcessNodeColors();
            postProcessNodeTasks();
```

- [ ] **Step 3: Update `adicionarNoMapa()` — add badge to HTML template and `tasks:[]` to data**

Find in `adicionarNoMapa()`:
```javascript
            const html = `<div class="glass-node" style="border-left: 4px solid ${c.color}">
                <button class="node-gear-btn" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); abrirCtxMenuGear(event, this)"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                <div class="node-header"><i class="fa-solid ${c.icon}" style="color:${c.color}"></i></div>
                <input type="text" df-label value="${c.label}" class="node-label w-full bg-transparent outline-none font-bold text-[0.8rem] text-slate-900 dark:text-slate-100 placeholder-slate-400 mb-1" placeholder="Nome do cartão..." onmousedown="event.stopPropagation()">
                <textarea df-description rows="2" class="w-full bg-transparent outline-none text-[9px] text-slate-500 resize-none placeholder-slate-400 leading-tight" placeholder="Adicione uma descrição (opcional)..." onmousedown="event.stopPropagation()"></textarea>
                <input type="hidden" df-link value="">
                <a class="node-link-badge" href="#" target="_blank" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" title="Abrir link anexado"><i class="fa-solid fa-link"></i></a>
            </div>`;
            mapaEditor.addNode(categoria, 1, 1, pos.x, pos.y, categoria, { label: c.label, description: '', link: '', color: '' }, html);
```

Replace with:
```javascript
            const html = `<div class="glass-node" style="border-left: 4px solid ${c.color}">
                <button class="node-gear-btn" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); abrirCtxMenuGear(event, this)"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                <div class="node-header"><i class="fa-solid ${c.icon}" style="color:${c.color}"></i></div>
                <input type="text" df-label value="${c.label}" class="node-label w-full bg-transparent outline-none font-bold text-[0.8rem] text-slate-900 dark:text-slate-100 placeholder-slate-400 mb-1" placeholder="Nome do cartão..." onmousedown="event.stopPropagation()">
                <textarea df-description rows="2" class="w-full bg-transparent outline-none text-[9px] text-slate-500 resize-none placeholder-slate-400 leading-tight" placeholder="Adicione uma descrição (opcional)..." onmousedown="event.stopPropagation()"></textarea>
                <input type="hidden" df-link value="">
                <a class="node-link-badge" href="#" target="_blank" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" title="Abrir link anexado"><i class="fa-solid fa-link"></i></a>
                <span class="node-task-badge" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); abrirModalTarefas(_nodeIdFromEl(this))"></span>
            </div>`;
            mapaEditor.addNode(categoria, 1, 1, pos.x, pos.y, categoria, { label: c.label, description: '', link: '', color: '', tasks: [] }, html);
```

- [ ] **Step 4: Add `_nodeIdFromEl` helper** (needed by the badge onclick)

Add after `_renderNodeTaskBadge`:
```javascript
        function _nodeIdFromEl(el) {
            const dn = el.closest('.drawflow-node');
            return dn ? parseInt(dn.id.replace('node-', ''), 10) : null;
        }
```

- [ ] **Step 5: Manual test**
  - Create two new nodes
  - Both should show no badge (correct — no tasks yet)
  - Refresh to a saved map with old nodes (no `tasks` field) — map should load without error

---

## Task 5: Front A — Load Responsáveis + Context Menu Item

**Files:**
- Modify: `index.html` — global variables section (~4195 area), `initMapa()`, `_buildCtxMenu()`

**What to implement:**
- Global `_responsaveisDisponiveis = []`
- `carregarResponsaveisDisponiveis()` async function
- Call from `initMapa()` after `carregarMapas()`
- Add "Gerenciar Tarefas" button to context menu

- [ ] **Step 1: Find global variable declarations in the mapa section**

Search for the line that declares `let mapaEditor`, `let mapasUsuario`, etc. near line ~4195.

Find the block of `let` declarations and add after them:
```javascript
        let _responsaveisDisponiveis = []; // populated by carregarResponsaveisDisponiveis()
```

- [ ] **Step 2: Add `carregarResponsaveisDisponiveis` function**

Add this function after `postProcessNodeTasks` (or any logical location near other async init functions):

```javascript
        async function carregarResponsaveisDisponiveis() {
            const uid = localStorage.getItem('giif_user_id');
            if (!uid) return;
            try {
                const res = await fetch(`${N8N_BASE_URL}/api-gateway`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Authorization': `Bearer ${getToken()}` },
                    body: JSON.stringify({ acao: 'listar_responsaveis_mapa', usuario_id: uid })
                });
                if (!res.ok) throw new Error('http ' + res.status);
                const data = await res.json();
                _responsaveisDisponiveis = Array.isArray(data) ? data : [];
            } catch (e) {
                console.warn('[GIIF][Mapa] Fallback: responsáveis não carregados.', e);
                _responsaveisDisponiveis = [];
            }
        }
```

- [ ] **Step 3: Call from `initMapa()`**

In `initMapa()`, find:
```javascript
            carregarMapas();
        }
```

Replace with:
```javascript
            carregarMapas();
            carregarResponsaveisDisponiveis();
        }
```

- [ ] **Step 4: Add "Gerenciar Tarefas" to context menu**

In `_buildCtxMenu()`, find:
```javascript
                <div class="ctx-divider"></div>
                <button class="ctx-item ctx-danger" onclick="ctxExcluirNode()"><i class="fa-solid fa-trash-can"></i> Excluir Nó</button>
```

Replace with:
```javascript
                <div class="ctx-divider"></div>
                <button class="ctx-item" onclick="ctxGerenciarTarefas()"><i class="fa-solid fa-list-check"></i> Gerenciar Tarefas</button>
                <div class="ctx-divider"></div>
                <button class="ctx-item ctx-danger" onclick="ctxExcluirNode()"><i class="fa-solid fa-trash-can"></i> Excluir Nó</button>
```

- [ ] **Step 5: Add `ctxGerenciarTarefas` function**

Add after `ctxExcluirNode`:
```javascript
        function ctxGerenciarTarefas() {
            if (_ctxTargetNodeId == null) return;
            const nodeId = _ctxTargetNodeId;
            fecharCtxMenu();
            abrirModalTarefas(nodeId);
        }
```

- [ ] **Step 6: Manual test**
  - Right-click a node → context menu should show "Gerenciar Tarefas" item
  - Clicking it should not crash (function exists even if modal is stub)

---

## Task 6: Front A — Task Management Modal

**Files:**
- Modify: `index.html` JS section (add after `ctxGerenciarTarefas`)

**What to implement:** Full `abrirModalTarefas(nodeId)` with SweetAlert2 HTML modal.

Design notes:
- Modal renders a `<div id="tasks-modal-body">` with all tasks
- Each task row: checkbox, editable text, date, responsible selector, subtask toggle, delete
- Subtask area toggled with a chevron button per task
- All changes write immediately to Drawflow data then call `_setNodeTasks` + `_renderNodeTaskBadge`
- Modal stays open after every change (uses `Swal.update` or full `Swal.fire` with `willOpen`)
- DOMPurify sanitizes all text inputs and manual responsible name

- [ ] **Step 1: Add `_buildResponsavelOptions(selectedId, selectedNome)` helper**

```javascript
        function _buildResponsavelOptions(selectedId, selectedNome) {
            const uid = localStorage.getItem('giif_user_id');
            const userNome = localStorage.getItem('giif_user_nome') || 'Eu mesmo';
            let html = `<option value="eu:${DOMPurify.sanitize(userNome)}" ${!selectedId && selectedNome === userNome ? 'selected' : ''}>${DOMPurify.sanitize(userNome)} (Eu)</option>`;
            _responsaveisDisponiveis.forEach(r => {
                const sel = selectedId === r.id ? 'selected' : '';
                html += `<option value="consultor:${r.id}:${DOMPurify.sanitize(r.nome_completo)}" ${sel}>${DOMPurify.sanitize(r.nome_completo)}</option>`;
            });
            // If saved responsavel is not in the current list, show it anyway
            if (selectedNome && selectedId && !_responsaveisDisponiveis.find(r => r.id === selectedId)) {
                html += `<option value="consultor:${selectedId}:${DOMPurify.sanitize(selectedNome)}" selected>${DOMPurify.sanitize(selectedNome)} (não vinculado)</option>`;
            }
            html += `<option value="outro" ${!selectedId && selectedNome && selectedNome !== userNome ? 'selected' : ''}>Outro (digitar nome)</option>`;
            return html;
        }
```

- [ ] **Step 2: Add `_renderTasksHTML(tasks)` helper**

```javascript
        function _renderTasksHTML(tasks) {
            if (!tasks.length) {
                return `<p style="text-align:center;color:#94a3b8;font-size:12px;padding:20px 0">Nenhuma tarefa. Clique em "+ Tarefa" para começar.</p>`;
            }
            return tasks.map((t, ti) => {
                const subtasksDone = (t.subtarefas||[]).filter(s=>s.concluida).length;
                const subtasksTotal = (t.subtarefas||[]).length;
                const subBadge = subtasksTotal ? `<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(99,102,241,0.1);color:#6366f1;font-weight:700">${subtasksDone}/${subtasksTotal}</span>` : '';
                const subRows = (t.subtarefas||[]).map((s, si) => `
                    <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.04)" data-sub-id="${s.id}">
                        <input type="checkbox" ${s.concluida?'checked':''} onchange="taskToggleSub(${ti},${si},this.checked)" style="width:13px;height:13px;cursor:pointer;flex-shrink:0">
                        <input type="text" value="${DOMPurify.sanitize(s.texto)}" placeholder="Subtarefa..." onblur="taskEditSub(${ti},${si},this.value)"
                            style="flex:1;border:none;background:transparent;font-size:11px;outline:none;${s.concluida?'text-decoration:line-through;color:#94a3b8;':''}" onmousedown="event.stopPropagation()">
                        <button onclick="taskDeleteSub(${ti},${si})" style="background:none;border:none;color:#ef4444;cursor:pointer;padding:2px 4px;border-radius:4px;font-size:11px" title="Remover"><i class="fa-solid fa-xmark"></i></button>
                    </div>`).join('');

                return `
                <div class="tm-task-row" data-task-id="${t.id}" style="border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.6)">
                    <div style="display:flex;align-items:flex-start;gap:8px">
                        <input type="checkbox" ${t.concluida?'checked':''} onchange="taskToggle(${ti},this.checked)" style="margin-top:3px;width:14px;height:14px;cursor:pointer;flex-shrink:0">
                        <div style="flex:1;min-width:0">
                            <input type="text" value="${DOMPurify.sanitize(t.texto)}" placeholder="Texto da tarefa..." onblur="taskEditTexto(${ti},this.value)"
                                style="width:100%;border:none;background:transparent;font-size:12px;font-weight:600;outline:none;${t.concluida?'text-decoration:line-through;color:#94a3b8;':''}" onmousedown="event.stopPropagation()">
                            <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
                                <input type="date" value="${t.prazo||''}" onchange="taskEditPrazo(${ti},this.value)"
                                    style="border:1px solid rgba(0,0,0,0.1);border-radius:4px;padding:2px 6px;font-size:10px;background:transparent;color:inherit;cursor:pointer" onmousedown="event.stopPropagation()">
                                <select onchange="taskEditResponsavel(${ti},this.value)" style="border:1px solid rgba(0,0,0,0.1);border-radius:4px;padding:2px 4px;font-size:10px;background:transparent;color:inherit;max-width:160px" onmousedown="event.stopPropagation()">
                                    <option value="">— Responsável —</option>
                                    ${_buildResponsavelOptions(t.responsavel_consultor_id, t.responsavel_nome)}
                                </select>
                                ${t._showOutroInput ? `<input type="text" value="${DOMPurify.sanitize(t.responsavel_nome||'')}" placeholder="Nome do responsável..." onblur="taskEditResponsavelManual(${ti},this.value)"
                                    style="border:1px solid rgba(0,0,0,0.1);border-radius:4px;padding:2px 6px;font-size:10px;background:transparent;color:inherit;width:120px" onmousedown="event.stopPropagation()">` : ''}
                                ${subBadge}
                            </div>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
                            <button onclick="taskToggleSubList(${ti})" style="background:none;border:none;color:#6366f1;cursor:pointer;padding:2px 5px;border-radius:4px;font-size:10px" title="Subtarefas">
                                <i class="fa-solid fa-chevron-${t._expanded?'up':'down'}"></i>
                            </button>
                            <button onclick="taskDelete(${ti})" style="background:none;border:none;color:#ef4444;cursor:pointer;padding:2px 5px;border-radius:4px;font-size:11px" title="Excluir tarefa">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                    ${t._expanded ? `
                    <div style="margin-top:8px;padding-top:8px;border-top:1px dashed rgba(0,0,0,0.08);padding-left:22px">
                        ${subRows}
                        <button onclick="taskAddSub(${ti})" style="margin-top:6px;background:none;border:1px dashed rgba(99,102,241,0.4);color:#6366f1;border-radius:5px;padding:3px 10px;font-size:10px;cursor:pointer;width:100%;font-weight:700">
                            <i class="fa-solid fa-plus"></i> Subtarefa
                        </button>
                    </div>` : ''}
                </div>`;
            }).join('');
        }
```

- [ ] **Step 3: Add `_tmNodeId` and `_tmTasks` module-level vars + `_refreshTaskModal`**

```javascript
        let _tmNodeId = null;
        let _tmTasks  = [];

        function _refreshTaskModal() {
            const body = document.getElementById('tasks-modal-body');
            if (!body) return;
            body.innerHTML = _renderTasksHTML(_tmTasks);
            // Apply dark mode manually inside modal
            if (document.documentElement.classList.contains('dark')) {
                body.querySelectorAll('.tm-task-row').forEach(el => {
                    el.style.background = 'rgba(15,23,42,0.6)';
                    el.style.borderColor = 'rgba(255,255,255,0.08)';
                });
            }
            _setNodeTasks(_tmNodeId, _tmTasks);
            _renderNodeTaskBadge(_tmNodeId);
        }
```

- [ ] **Step 4: Add task mutation functions (used by onclick in HTML strings)**

```javascript
        function taskToggle(ti, checked) {
            if (!_tmTasks[ti]) return;
            _tmTasks[ti].concluida = checked;
            _refreshTaskModal();
        }

        function taskEditTexto(ti, val) {
            const clean = DOMPurify.sanitize(val.trim());
            if (!clean) return;
            if (!_tmTasks[ti]) return;
            _tmTasks[ti].texto = clean;
            _setNodeTasks(_tmNodeId, _tmTasks);
            _renderNodeTaskBadge(_tmNodeId);
        }

        function taskEditPrazo(ti, val) {
            if (!_tmTasks[ti]) return;
            _tmTasks[ti].prazo = val || null;
            _setNodeTasks(_tmNodeId, _tmTasks);
            _renderNodeTaskBadge(_tmNodeId);
        }

        function taskEditResponsavel(ti, val) {
            if (!_tmTasks[ti]) return;
            if (val === 'outro') {
                _tmTasks[ti]._showOutroInput = true;
                _tmTasks[ti].responsavel_nome = '';
                _tmTasks[ti].responsavel_consultor_id = null;
            } else if (val.startsWith('eu:')) {
                _tmTasks[ti].responsavel_nome = val.slice(3);
                _tmTasks[ti].responsavel_consultor_id = null;
                _tmTasks[ti]._showOutroInput = false;
            } else if (val.startsWith('consultor:')) {
                const parts = val.split(':');
                _tmTasks[ti].responsavel_consultor_id = parts[1];
                _tmTasks[ti].responsavel_nome = parts.slice(2).join(':');
                _tmTasks[ti]._showOutroInput = false;
            } else {
                _tmTasks[ti].responsavel_nome = null;
                _tmTasks[ti].responsavel_consultor_id = null;
                _tmTasks[ti]._showOutroInput = false;
            }
            _refreshTaskModal();
        }

        function taskEditResponsavelManual(ti, val) {
            if (!_tmTasks[ti]) return;
            const clean = DOMPurify.sanitize(val.trim());
            _tmTasks[ti].responsavel_nome = clean || null;
            _setNodeTasks(_tmNodeId, _tmTasks);
            _renderNodeTaskBadge(_tmNodeId);
        }

        function taskDelete(ti) {
            _tmTasks.splice(ti, 1);
            _refreshTaskModal();
        }

        function taskToggleSubList(ti) {
            if (!_tmTasks[ti]) return;
            _tmTasks[ti]._expanded = !_tmTasks[ti]._expanded;
            _refreshTaskModal();
        }

        function taskToggleSub(ti, si, checked) {
            const t = _tmTasks[ti];
            if (!t || !t.subtarefas[si]) return;
            t.subtarefas[si].concluida = checked;
            // Auto-complete parent when all subs done
            const allDone = t.subtarefas.every(s => s.concluida);
            const anyPending = t.subtarefas.some(s => !s.concluida);
            if (allDone) t.concluida = true;
            if (anyPending && t.concluida) t.concluida = false;
            _refreshTaskModal();
        }

        function taskEditSub(ti, si, val) {
            const clean = DOMPurify.sanitize(val.trim());
            if (!clean) return;
            if (!_tmTasks[ti]?.subtarefas[si]) return;
            _tmTasks[ti].subtarefas[si].texto = clean;
            _setNodeTasks(_tmNodeId, _tmTasks);
            _renderNodeTaskBadge(_tmNodeId);
        }

        function taskDeleteSub(ti, si) {
            if (!_tmTasks[ti]) return;
            _tmTasks[ti].subtarefas.splice(si, 1);
            _refreshTaskModal();
        }

        function taskAddSub(ti) {
            if (!_tmTasks[ti]) return;
            _tmTasks[ti].subtarefas = _tmTasks[ti].subtarefas || [];
            _tmTasks[ti].subtarefas.push({
                id: 'subtarefa_' + Date.now() + '_' + Math.random().toString(36).slice(2),
                texto: 'Nova subtarefa',
                concluida: false
            });
            _refreshTaskModal();
        }

        function taskAddNew() {
            _tmTasks.push({
                id: 'tarefa_' + Date.now() + '_' + Math.random().toString(36).slice(2),
                texto: 'Nova tarefa',
                concluida: false,
                prazo: null,
                responsavel_nome: null,
                responsavel_consultor_id: null,
                subtarefas: [],
                _expanded: false,
                _showOutroInput: false
            });
            _refreshTaskModal();
        }
```

- [ ] **Step 5: Add `abrirModalTarefas(nodeId)` function**

```javascript
        async function abrirModalTarefas(nodeId) {
            if (nodeId == null || !mapaEditor) return;
            _tmNodeId = nodeId;
            // Deep-clone tasks to avoid mutation issues; strip transient _ fields on load
            const raw = _getNodeTasks(nodeId);
            _tmTasks = raw.map(t => ({
                ...t,
                subtarefas: (t.subtarefas || []).map(s => ({...s})),
                _expanded: false,
                _showOutroInput: false
            }));

            const isDark = document.documentElement.classList.contains('dark');
            const nodeData = mapaEditor.drawflow.drawflow.Home.data[nodeId]?.data;
            const nodeLabel = DOMPurify.sanitize(nodeData?.label || `Nó ${nodeId}`);

            await Swal.fire({
                title: `<i class="fa-solid fa-list-check" style="color:#3B55E6;margin-right:8px"></i> Tarefas — ${nodeLabel}`,
                html: `
                    <div id="tasks-modal-body" style="max-height:50vh;overflow-y:auto;text-align:left;padding:4px 2px"></div>
                    <button onclick="taskAddNew()" style="margin-top:10px;width:100%;background:rgba(59,85,230,0.08);border:1px dashed rgba(59,85,230,0.4);color:#3B55E6;border-radius:8px;padding:6px;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:0.05em">
                        <i class="fa-solid fa-plus"></i> NOVA TAREFA
                    </button>`,
                didOpen: () => {
                    _refreshTaskModal();
                },
                showCancelButton: false,
                confirmButtonText: 'Fechar',
                confirmButtonColor: '#3B55E6',
                background: isDark ? '#1E1E1E' : '#fff',
                color: isDark ? '#fff' : '#0f172a',
                width: '520px',
                customClass: { popup: 'tasks-modal-popup' }
            });

            // Clean transient UI-only fields before final persist
            _tmTasks.forEach(t => {
                delete t._expanded;
                delete t._showOutroInput;
                t.subtarefas.forEach(s => { delete s._expanded; });
            });
            _setNodeTasks(_tmNodeId, _tmTasks);
            _renderNodeTaskBadge(_tmNodeId);
            _tmNodeId = null;
            _tmTasks = [];
        }
```

- [ ] **Step 6: Manual test — critical path**
  - Create a node
  - Right-click → "Gerenciar Tarefas" — modal opens
  - Click "+ NOVA TAREFA" — task row appears
  - Edit task text, set date, set responsible
  - Add subtask via chevron + "Subtarefa" button
  - Check subtask → parent auto-completes when all done
  - Close modal → badge appears on node with count
  - Save map, reload page, reopen node tasks — data persists

---

## Task 7: Backend — listar_responsaveis_mapa Gateway Action

**Files:**
- Modify: `C:\Users\marco\Downloads\GIIF - Gateway Master Update (Corrigido) (6).json`

**What to implement:** Add a new Switch case + Postgres node + respondToWebhook for action `listar_responsaveis_mapa`.

**IMPORTANT:** The gateway file is NOT in this repository. Locate it at the path above. The pattern to follow is the existing `salvar_mapa` / `carregar_mapas` branch. The `"Validador JWT Cliente"` Code node already overwrites `item.body.usuario_id = payloadObj.usuario_id`, preventing IDOR.

- [ ] **Step 1: Open the gateway JSON file**

Open: `C:\Users\marco\Downloads\GIIF - Gateway Master Update (Corrigido) (6).json`

Locate the Switch node that routes based on `{{ $json.body.acao }}`. Find the existing outputs and identify the last `output_` index used.

- [ ] **Step 2: Add new Switch output rule**

In the Switch node's `rules.values` array, add a new entry (using the next available output index, e.g., `output_7`):
```json
{
    "value": "listar_responsaveis_mapa"
}
```

And in `rules.output_` for that index, wire it to the new Postgres node.

- [ ] **Step 3: Add Postgres query node**

Add a new node of type `n8n-nodes-base.postgres` wired from the new Switch output:
```json
{
    "parameters": {
        "operation": "executeQuery",
        "query": "SELECT u.id, u.nome_completo FROM consultor_clientes cc JOIN usuarios_giif u ON u.id = cc.consultor_id WHERE cc.usuario_id = $1 ORDER BY u.nome_completo ASC",
        "options": {
            "queryReplacement": "={{ $json.body.usuario_id }}"
        }
    },
    "name": "Listar Responsaveis Mapa",
    "type": "n8n-nodes-base.postgres",
    "credentials": { ... }  // copy from existing postgres node
}
```

- [ ] **Step 4: Add respond node**

Wire a new `n8n-nodes-base.respondToWebhook` node after the Postgres node:
```json
{
    "parameters": {
        "respondWith": "json",
        "responseBody": "={{ $json }}"
    },
    "name": "Responder Responsaveis",
    "type": "n8n-nodes-base.respondToWebhook"
}
```

Add an If node between Postgres and respond to handle empty results gracefully:
- If Postgres returns 0 rows → respond with `[]`
- Otherwise respond with the rows array

Pattern to follow: look at how `carregar_mapas` handles the empty-result case in the gateway.

- [ ] **Step 5: Import and activate**

Import the modified JSON into n8n. Activate the workflow. Test via POST:
```json
{ "acao": "listar_responsaveis_mapa", "usuario_id": "VALID_USER_ID" }
```
with a valid JWT. Expect array of `{id, nome_completo}` or `[]`.

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task covering it |
|---|---|
| A.1 Backend `listar_responsaveis_mapa` | Task 7 |
| A.2 Task data structure in `data.tasks` | Task 4 |
| A.3 `carregarResponsaveisDisponiveis` | Task 5 |
| A.4 Badge with fa-list-check, colors, tooltip | Tasks 3+4 |
| A.5 Modal with all task fields | Task 6 |
| A.6 `postProcessNodeTasks`, retrocompat | Task 4 |
| A.7 Export PNG badge visibility | Task 3 |
| B.1 Connector hit area `::before` + hover | Task 1 |
| B.2 `is-connecting` feedback | Task 2 |
| B.3 Grabbing cursor | Task 2 |
| B.4 Connection path selection | Task 1 |
| B.5 Zoom controls | Task 2 |
| Security: DOMPurify sanitize | Task 6 |
| Security: JWT/IDOR in backend | Task 7 (validator already handles IDOR) |
| Security: `queryReplacement` not interpolation | Task 7 |
| Retrocompat: old maps without `tasks` | Task 4 (`_getNodeTasks` defaults to `[]`) |

### Potential issues

1. **Swal `willOpen` vs `didOpen`**: The spec needs `_refreshTaskModal` to run after the modal DOM is inserted. Use `didOpen` (not `willOpen`) — `willOpen` fires before HTML is in DOM.

2. **`_tmTasks` is module-level state**: If two modals somehow opened (can't happen with Swal blocking UI), state would collide. This is safe because Swal is a blocking modal.

3. **Task mutation functions are global**: `taskAddNew`, `taskToggle`, etc. are called via `onclick` strings inside `innerHTML`. They must be on `window` scope (top-level `function` declarations are). This is correct.

4. **Overdue detection uses `T00:00:00`**: `new Date('2025-01-15T00:00:00')` avoids timezone-shift issues from `new Date('2025-01-15')` (which parses as UTC midnight → could appear as previous day in UTC-offset locales).

5. **Badge left-side positioning**: `node-link-badge` is bottom-right; `node-task-badge` is bottom-left — they don't overlap.

6. **`_showOutroInput` and `_expanded` are transient**: Deleted before final `_setNodeTasks` call on modal close. They won't be persisted in `mapa_json`.

7. **Backend empty result**: n8n Postgres returns `[]` when 0 rows — the Switch+If pattern covers this. Double-check the gateway's existing `carregar_mapas` branch for the exact empty-array-respond pattern.
