/* ============================================================
   GIIF System — Admin Panel | Core Logic
   ============================================================
   Architecture: Single Gateway (POST /api-admin-gateway)
   Mode: Hybrid (live actions hit n8n, others use mock)
   ============================================================ */

// ===== CONFIG =====
const N8N_BASE_URL = '/api';
const GATEWAY_ENDPOINT = '/api-admin-gateway';
const COST_PER_DIAGNOSTIC = 0.70; // R$ estimate per diagnostic (~US$0.12)
const PLAN_PRICING = { parceiro: 0, consultor: 0, essencial: 197, profissional: 397, enterprise: null, premium: null, estrategico: null };

// All actions hit n8n backend.
const ACTION_MAP = {
    'admin_login': 'login',
    'dashboard_stats': 'dashboard_completo'
    // Other actions already match their n8n names
};


// ===== TAREFA 4: extractCleanText — Blindagem contra "Double JSON" =====
// Problema: o n8n pode retornar relatorio_texto como uma string que COMEÇA
// com '{', significando que a IA embutiu um segundo JSON dentro do campo.
// Esta função desempacota isso e garante que o front-end sempre receba
// Markdown puro, sem estrutura JSON visível.
function extractCleanText(data) {
    if (!data) return null;

    // Suporte a array (n8n retorna [{ relatorio_texto, scores }])
    const item = Array.isArray(data) ? data[0] : data;
    if (!item) return null;

    let rt = item.relatorio_texto || item.texto || '';

    // Caso 1: Double JSON — relatorio_texto começa com '{'
    if (typeof rt === 'string' && rt.trimStart().startsWith('{')) {
        try {
            const inner = JSON.parse(rt);
            rt = inner.relatorio_texto || rt;
        } catch (_) {
            // Não era JSON válido — tenta regex de extração
            const m = rt.match(/"relatorio_texto"\s*:\s*"([\s\S]*?)(?=",\s*"scores"|"\s*})/);
            if (m && m[1]) {
                rt = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
            } else {
                // Remove chaves soltas do início e fim como último recurso
                rt = rt.replace(/^\s*\{/, '').replace(/\}\s*$/, '').trim();
            }
        }
    }

    // Garantia final: nunca retornar string que começa/termina com chaves JSON
    if (/^\s*\{/.test(rt) && /\}\s*$/.test(rt)) {
        rt = rt.replace(/^\s*\{/, '').replace(/\}\s*$/, '').trim();
    }

    return {
        ...item,
        relatorio_texto: rt
    };
}

// ===== STATE =====
let adminState = {
    currentView: 'dashboard',
    users: [],
    billing: [],
    health: [],
    consultants: [],
    tickets: [],
    charts: { revenue: null, plans: null, billing: null }
};

// HTML Entity escaper for XSS prevention
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── Delegated onclick handlers — data-* pattern prevents JS string injection in onclick ──
function handleOfferClick(btn) {
    openOfferModal(btn.dataset.uid, btn.dataset.empresa, Number(btn.dataset.score));
}
function handleResetPasswordClick(btn) {
    openResetPasswordModal(btn.dataset.uid, btn.dataset.nome);
}
function handleEditUserClick(btn) {
    openEditUserModal(btn.dataset.uid);
}
function handleToggleStatusClick(btn) {
    toggleUserStatus(btn.dataset.uid);
}
function handleDeleteUserClick(btn) {
    deleteUser(btn.dataset.uid);
}
function handleEditConsultantLinksClick(btn) {
    openEditConsultantLinksModal(btn.dataset.cid, btn.dataset.nome);
}
function handleTicketClick(btn) {
    openTicketModal(btn.dataset.tid);
}

// Parse arrays from PostgreSQL (handles JSON, Postgres {val1,val2} format, and plain arrays)
function parsePostgresArray(val) {
    if (Array.isArray(val)) return val.filter(Boolean);
    if (!val || val === 'null' || val === '{}' || val === '[]') return [];
    if (typeof val === 'string') {
        // Try JSON first: ["a","b"]
        try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) return parsed.filter(Boolean);
        } catch { /* not JSON */ }
        // PostgreSQL aggregate format: {val1,val2}
        if (val.startsWith('{') && val.endsWith('}')) {
            return val.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
        }
    }
    return [];
}

// UI Toggles for Admin Plans
function toggleAdminModuloOptions(prefix) {
    const plan = document.getElementById(`${prefix}-user-plan`).value;
    const container = document.getElementById(`${prefix}-user-modulo-container`);
    if (plan === 'essencial') {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

function toggleAdminModuloSelect(prefix) {
    const radios = document.getElementsByName(`${prefix}_modulo_mode`);
    let mode = 'admin';
    for (const r of radios) { if (r.checked) mode = r.value; }
    const select = document.getElementById(`${prefix}-user-modulo-select`);
    if (mode === 'admin') {
        select.classList.remove('hidden');
    } else {
        select.classList.add('hidden');
    }
}

// ===== GATEWAY (Fetch Abstraction — Bulletproof) =====
async function adminGateway(acao, params = {}) {
    // Resolve the n8n action name
    const n8nAction = ACTION_MAP[acao] || acao;

    // ── 1. FETCH (network / CORS errors land here) ──
    let res;
    try {
        res = await fetch(`${N8N_BASE_URL}${GATEWAY_ENDPOINT}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Authorization': `Bearer ${sessionStorage.getItem('giif_admin_token')}`
            },
            body: JSON.stringify({
                acao: n8nAction,
                admin_id: sessionStorage.getItem('giif_admin_id'),
                admin_nome: sessionStorage.getItem('giif_admin_nome') || '',
                ...params
            })
        });
    } catch (networkErr) {
        // This fires when the browser cannot reach the server at all,
        // OR when CORS blocks the preflight / response reading.
        console.error(
            `[Gateway] ❌ NETWORK/CORS error for "${n8nAction}".`,
            '\n→ Verifique se o n8n está acessível e se os headers CORS estão configurados.',
            '\n→ Erro original:', networkErr
        );
        showToast('Falha de conexão com o servidor (rede/CORS).', 'error');
        return null;
    }

    // ── 2. HTTP STATUS CHECK ──
    // We always read the body as text first so we can log it regardless of format.
    let rawText;
    try {
        rawText = await res.text();
    } catch (readErr) {
        console.error(`[Gateway] ❌ Não foi possível ler o corpo da resposta para "${n8nAction}":`, readErr);
        showToast('Erro ao ler resposta do servidor.', 'error');
        return null;
    }

    if (!res.ok) {
        console.error(
            `[Gateway] ❌ HTTP ${res.status} ${res.statusText} para "${n8nAction}"`,
            '\n→ Headers:', Object.fromEntries(res.headers.entries()),
            '\n→ Body (raw):', rawText.substring(0, 2000)
        );
        showToast(`Erro do servidor (HTTP ${res.status}).`, 'error');
        return null;
    }

    // ── 3. JSON PARSE (invalid JSON from n8n lands here) ──
    let data;
    try {
        data = JSON.parse(rawText);
    } catch (jsonErr) {
        console.error(
            `[Gateway] ❌ JSON inválido para "${n8nAction}".`,
            '\n→ O n8n retornou HTTP 200, mas o body NÃO é JSON válido.',
            '\n→ Content-Type:', res.headers.get('content-type'),
            '\n→ Body (raw, primeiros 2000 chars):', rawText.substring(0, 2000),
            '\n→ Erro de parse:', jsonErr
        );
        showToast('Resposta do servidor não é JSON válido.', 'error');
        return null;
    }

    // ── 4. SUCCESS — normalize and return ──
    // Production: suppress full payload dump to prevent data leaks via console
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        console.log(`[Gateway] ✅ "${n8nAction}" → HTTP ${res.status}`, data);
    } else {
        console.log(`[Gateway] ✅ "${n8nAction}" → HTTP ${res.status} (${Array.isArray(data) ? data.length + ' registros' : 'OK'})`);
    }
    return normalizeResponse(n8nAction, data);
}

// Normalize n8n responses to match the format the frontend expects
function normalizeResponse(action, data) {
    // If data is an array (n8n returns array of items)
    if (Array.isArray(data)) {
        switch (action) {
            case 'login':
            case 'admin_login':
                return data[0] || { sucesso: false, mensagem: 'Resposta inválida do servidor.' };
            case 'listar_usuarios':
                return data.map(u => ({
                    ...u,
                    criado_em: u.criado_em || null,
                    diagnosticos_count: parseInt(u.diagnosticos_count) || 0
                }));
            case 'listar_logs_atividade':
                return data;
            case 'dashboard_completo':
            case 'dashboard_metricas':
                // n8n returns [{ total_usuarios, ... }]
                return data[0] || {};
            case 'listar_billing':
                return data.map(d => {
                    const planoBase = (d.plano || '').startsWith('essencial') ? 'essencial' : (d.plano || '');
                    const backendValor = d.valor_pago !== null && d.valor_pago !== undefined ? parseFloat(d.valor_pago) : null;
                    const planoValor = PLAN_PRICING[planoBase];
                    return {
                        ...d,
                        diagnosticos: parseInt(d.diagnosticos) || 0,
                        custo_estimado: parseFloat(d.custo_estimado) || 0,
                        valor_pago: backendValor !== null ? backendValor : (planoValor !== undefined ? planoValor : null)
                    };
                });
            case 'listar_health':
                return data.map(h => ({
                    usuario_id: h.usuario_id,
                    empresa: h.empresa || h.nome_empresa,
                    score_global: parseInt(h.score_global) || Math.floor(Math.random() * 60 + 20),
                    gargalo: h.gargalo || 'A definir',
                    modulos: h.modulos || [],
                    diagnosticos_count: parseInt(h.diagnosticos_count) || 0,
                    plano: h.plano,
                    ultima_analise: h.ultima_analise || new Date().toISOString()
                }));
            case 'listar_consultores':
                return data.map(c => {
                    const clientes = parsePostgresArray(c.clientes);
                    const clientes_ids = parsePostgresArray(c.clientes_ids).map(String);
                    const qtd_clientes = parseInt(c.qtd_clientes) || Math.max(clientes.length, clientes_ids.length);
                    return { ...c, clientes, clientes_ids, qtd_clientes };
                });
            case 'criar_usuario':
            case 'criar_consultor':
            case 'atribuir_consultor':
                // n8n may return [{ id }] from RETURNING clause
                return { sucesso: true, ...(data[0] || {}) };
            default:
                return data;
        }
    }
    return data;
}

// MockGateway Removido. A plataforma agora funciona 100% online.

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('admin_theme') === 'light') {
        document.documentElement.classList.remove('dark');
    }
    checkAdminSession();
});

// ===== AUTH =====
function checkAdminSession() {
    const adminId = sessionStorage.getItem('giif_admin_id');
    const adminName = sessionStorage.getItem('giif_admin_nome');
    if (adminId) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('admin-app').classList.remove('hidden');
        document.getElementById('admin-user-name').textContent = adminName || 'Admin';
        document.getElementById('admin-user-initials').textContent = (adminName || 'AD').substring(0, 2).toUpperCase();
        loadDashboard();
        fetchTicketBadge();
    }
}

async function fetchTicketBadge() {
    try {
        const data = await adminGateway('listar_tickets_admin');
        if (!data) return;
        let fallbackData = [];
        if (Array.isArray(data) && Array.isArray(data[0])) fallbackData = data[0];
        else if (Array.isArray(data)) fallbackData = data;

        adminState.tickets = fallbackData;

        const abertos = fallbackData.filter(t => t.status === 'Aberto').length;
        const badge = document.getElementById('sidebar-ticket-badge');
        if (badge) {
            if (abertos > 0) {
                badge.innerText = abertos > 5 ? '5+' : abertos;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (e) { }
}

async function adminLogin(event) {
    event.preventDefault();
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('login-error');
    err.classList.remove('visible');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Validando...';

    const data = await adminGateway('admin_login', {
        email: document.getElementById('login-email').value.trim(),
        senha: document.getElementById('login-password').value.trim()
    });

    // n8n returns { sucesso, admin_id/id, nome }
    const isSuccess = data && (data.sucesso === true || data.id);
    if (isSuccess) {
        sessionStorage.setItem('giif_admin_id', data.admin_id || data.id);
        sessionStorage.setItem('giif_admin_nome', data.nome || 'Admin');
        if (data.token) sessionStorage.setItem('giif_admin_token', data.token);
        checkAdminSession();
    } else {
        err.textContent = (data && data.mensagem) || 'E-mail ou senha incorretos. Acesso negado.';
        err.classList.add('visible');
    }
    btn.disabled = false;
    btn.innerHTML = 'Acessar Painel <i class="fa-solid fa-chevron-right" style="font-size:0.7rem"></i>';
}

function adminLogout() {
    sessionStorage.removeItem('giif_admin_id');
    sessionStorage.removeItem('giif_admin_nome');
    sessionStorage.removeItem('giif_admin_token');
    location.reload();
}

// ===== NAVIGATION =====
function navToAdmin(viewId) {
    adminState.currentView = viewId;

    // Toggle view visibility
    document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');

    // Toggle nav active state
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const navBtn = document.getElementById(`nav-${viewId}`);
    if (navBtn) navBtn.classList.add('active');

    // Update breadcrumb
    const breadcrumbs = {
        'dashboard': 'Dashboard', 'users': 'Gestão de Usuários', 'tickets': 'Interações / Suporte',
        'billing': 'Controle de Custos', 'health': 'Health Monitor', 'consultants': 'Consultores',
        'logs': 'Logs de Atividade'
    };
    document.getElementById('breadcrumb-current').textContent = breadcrumbs[viewId] || viewId;

    // Load data for view
    switch (viewId) {
        case 'dashboard': loadDashboard(); break;
        case 'users': loadUsers(); break;
        case 'tickets': loadTickets(); break;
        case 'billing': loadBilling(); break;
        case 'health': loadHealth(); break;
        case 'consultants': loadConsultants(); break;
        case 'logs': loadLogs(1); break;
    }
}

// ===== DASHBOARD =====
async function loadDashboard() {
    const liveData = await adminGateway('dashboard_stats') || {};

    // Mapeamento tolerante a falhas (caso a rota n8n retorne vazia/incompleta)
    const totalUsers = parseInt(liveData?.total_usuarios) || parseInt(liveData?.total_users) || 0;
    const planoParceiro = parseInt(liveData?.plano_parceiro) || 0;
    const planoEssencial = parseInt(liveData?.plano_essencial) || 0;
    const planoProfissional = parseInt(liveData?.plano_profissional) || 0;
    const planoEnterprise = parseInt(liveData?.plano_enterprise) || 0;
    const mrr = parseFloat(liveData?.mrr) || 0.0;
    const totalDiagnosticos = parseInt(liveData?.total_diagnosticos) || 0;
    const criticalCount = parseInt(liveData?.critical_count) || 0;

    // Fallback gracioso para os gráficos (Arrays zerados se ausente)
    const revChart = liveData?.revenue_chart || { labels: ['N/A'], data: [0] };

    const data = {
        total_users: totalUsers,
        mrr: mrr,
        critical_count: criticalCount,
        diagnostics_month: totalDiagnosticos,
        revenue_chart: revChart,
        plan_distribution: {
            parceiro: planoParceiro,
            essencial: planoEssencial,
            profissional: planoProfissional,
            enterprise: planoEnterprise
        }
    };

    document.getElementById('kpi-users').textContent = data.total_users;
    document.getElementById('kpi-mrr').textContent = `R$ ${data.mrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpi-critical').textContent = data.critical_count;
    document.getElementById('kpi-diagnostics').textContent = data.diagnostics_month;

    initDashboardCharts(data);
    loadDashboardAlerts();
}

function initDashboardCharts(data) {
    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#1e293b' : '#e5e7eb';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    // Revenue Chart
    const ctxRev = document.getElementById('chart-revenue');
    if (ctxRev) {
        if (adminState.charts.revenue) adminState.charts.revenue.destroy();
        adminState.charts.revenue = new Chart(ctxRev.getContext('2d'), {
            type: 'line',
            data: {
                labels: data.revenue_chart.labels,
                datasets: [{
                    data: data.revenue_chart.data,
                    borderColor: '#3B55E6',
                    backgroundColor: isDark ? 'rgba(99,102,241,0.05)' : 'rgba(99,102,241,0.1)',
                    fill: true, tension: 0.4, pointRadius: 4,
                    pointBackgroundColor: '#3B55E6', pointBorderColor: isDark ? '#111827' : '#fff',
                    pointBorderWidth: 3, borderWidth: 3
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { min: 0, ticks: { color: textColor, callback: v => `R$${(v / 1000).toFixed(0)}k` }, grid: { color: gridColor } },
                    x: { ticks: { color: textColor }, grid: { display: false } }
                },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `R$ ${ctx.raw.toLocaleString('pt-BR')}` } } }
            }
        });
    }

    // Plans Donut
    const ctxPlans = document.getElementById('chart-plans');
    if (ctxPlans) {
        if (adminState.charts.plans) adminState.charts.plans.destroy();
        adminState.charts.plans = new Chart(ctxPlans.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Parceiro', 'Essencial', 'Profissional', 'Enterprise'],
                datasets: [{
                    data: [data.plan_distribution.parceiro, data.plan_distribution.essencial, data.plan_distribution.profissional, data.plan_distribution.enterprise],
                    backgroundColor: ['#94a3b8', '#38bdf8', '#3B55E6', '#10b981'],
                    borderWidth: 0, hoverOffset: 8
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '72%',
                plugins: {
                    legend: { position: 'bottom', labels: { color: textColor, font: { weight: 'bold', size: 10 }, padding: 20, usePointStyle: true, pointStyle: 'circle' } }
                }
            }
        });
    }
}

async function loadDashboardAlerts() {
    const healthData = await adminGateway('listar_health');
    if (!healthData) return;

    const criticals = healthData.filter(h => h.score_global < 50).sort((a, b) => a.score_global - b.score_global).slice(0, 5);
    const tbody = document.getElementById('alerts-table-body');
    if (!tbody) return;

    tbody.innerHTML = criticals.map(h => `
        <tr>
            <td class="brand">${esc(h.empresa)}</td>
            <td><span class="health-score ${h.score_global < 40 ? 'critical' : 'warning'}" style="font-size:1.2rem">${h.score_global}</span></td>
            <td>${esc(h.gargalo)}</td>
            <td style="text-align:right">
                <button class="action-btn brand"
                    data-uid="${esc(h.usuario_id)}" data-empresa="${esc(h.empresa)}" data-score="${Number(h.score_global)||0}"
                    onclick="handleOfferClick(this)">
                    <i class="fa-solid fa-paper-plane"></i> Enviar Oferta
                </button>
            </td>
        </tr>
    `).join('');
}

// ===== USERS =====
let userFilterPlan = 'all';
let userFilterStatus = 'all';
let userSearchQuery = '';

async function loadUsers() {
    const data = await adminGateway('listar_usuarios');
    if (!data) return;
    adminState.users = data;
    renderUsersTable();
}

function filterUsers(type, value, btnElement) {
    if (type === 'plan') {
        userFilterPlan = value;
        document.querySelectorAll('#user-plan-filters .filter-btn').forEach(b => b.classList.remove('active'));
    } else if (type === 'status') {
        userFilterStatus = value;
        document.querySelectorAll('#user-status-filters .filter-btn').forEach(b => b.classList.remove('active'));
    }
    if (btnElement) btnElement.classList.add('active');
    renderUsersTable();
}

function searchUsers(query) {
    userSearchQuery = query.toLowerCase();
    renderUsersTable();
}

function renderUsersTable() {
    let filtered = [...adminState.users];

    if (userFilterPlan !== 'all') {
        filtered = filtered.filter(u => {
            const plan = u.plano || '';
            if (userFilterPlan === 'essencial') return plan.startsWith('essencial');
            return plan === userFilterPlan;
        });
    }
    if (userFilterStatus !== 'all') filtered = filtered.filter(u => u.status === userFilterStatus);
    if (userSearchQuery) filtered = filtered.filter(u =>
        u.nome.toLowerCase().includes(userSearchQuery) ||
        u.email.toLowerCase().includes(userSearchQuery) ||
        u.empresa.toLowerCase().includes(userSearchQuery)
    );

    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-users-slash"></i><p>Nenhum usuário encontrado com os filtros aplicados.</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(u => {
        const planoStr = u.plano || 'N/A';
        const planoBase = planoStr.startsWith('essencial') ? 'essencial' : planoStr;
        const planoLabel = planoStr.replace('essencial_', 'essencial · ');
        return `
        <tr>
            <td class="brand">${esc(u.nome)}${u.role === 'admin' ? ' <span class="badge badge-admin">ADMIN</span>' : (u.role === 'consultor' ? ' <span class="badge badge-partner">Consultor</span>' : '')}</td>
            <td style="font-size:0.75rem;color:var(--text-muted)">${esc(u.email)}</td>
            <td>${esc(u.empresa) || '---'}</td>
            <td><span class="badge badge-${esc(planoBase)}">${esc(planoLabel)}</span></td>
            <td><span class="badge badge-${esc(u.status)}"><i class="fa-solid fa-circle" style="font-size:0.35rem"></i> ${esc(u.status)}</span></td>
            <td style="font-size:0.75rem;color:var(--text-muted)">${u.criado_em ? new Date(u.criado_em).toLocaleDateString('pt-BR') : '---'}</td>
            <td style="font-weight:900;text-align:center">${u.diagnosticos_count}</td>
            <td style="text-align:right">
                <div style="display:flex;gap:0.4rem;justify-content:flex-end">
                    <button class="action-btn" data-uid="${esc(u.id)}" data-nome="${esc(u.nome)}" onclick="handleResetPasswordClick(this)" title="Resetar Senha"><i class="fa-solid fa-key"></i></button>
                    <button class="action-btn" data-uid="${esc(u.id)}" onclick="handleEditUserClick(this)" title="Editar Usuário"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="action-btn ${u.status === 'ativo' ? 'danger' : 'brand'}" data-uid="${esc(u.id)}" onclick="handleToggleStatusClick(this)" title="${u.status === 'ativo' ? 'Inativar' : 'Reativar'}">
                        <i class="fa-solid fa-${u.status === 'ativo' ? 'ban' : 'check'}"></i>
                    </button>
                    <button class="action-btn danger" data-uid="${esc(u.id)}" onclick="handleDeleteUserClick(this)" title="Excluir Permanentemente">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

function openCreateUserModal() {
    document.getElementById('modal-create-user').classList.add('active');
    document.getElementById('create-user-form').reset();
}

async function submitCreateUser(event) {
    event.preventDefault();
    const form = event.target;

    let planVal = form.querySelector('#new-user-plan').value;
    if (planVal === 'essencial') {
        let mode = 'admin';
        const radios = form.querySelectorAll('input[name="new_modulo_mode"]');
        for (const r of radios) { if (r.checked) mode = r.value; }

        if (mode === 'admin') {
            planVal = 'essencial_' + form.querySelector('#new-user-modulo-select').value;
        } else {
            planVal = 'essencial_pendente';
        }
    }

    const payload = {
        nome: form.querySelector('#new-user-name').value.trim(),
        email: form.querySelector('#new-user-email').value.trim(),
        senha: form.querySelector('#new-user-password').value.trim(),
        empresa: form.querySelector('#new-user-company').value.trim(),
        segmento: form.querySelector('#new-user-segment').value,
        plano: planVal,
        role: form.querySelector('#new-user-role').value
    };
    console.log('[DEBUG-TEMP] criar_usuario payload:', JSON.stringify(payload)); // DEBUG-TEMP — remover após confirmar causa do autofill
    const data = await adminGateway('criar_usuario', payload);

    const isSuccess = data && (data.sucesso || data.id);
    if (isSuccess) {
        closeModal('modal-create-user');
        showToast('Usuário criado com sucesso!', 'success');
        loadUsers();
    } else {
        showToast('Erro ao criar usuário.', 'error');
    }
}

function openResetPasswordModal(userId, userName) {
    document.getElementById('reset-user-id').value = userId;
    document.getElementById('reset-user-name').textContent = userName;
    document.getElementById('form-reset-password').reset();
    document.getElementById('modal-reset-password').classList.add('active');
}

function closeResetPasswordModal() {
    closeModal('modal-reset-password');
}

async function submitResetPassword(event) {
    event.preventDefault();
    const userId = document.getElementById('reset-user-id').value;
    const novaSenha = document.getElementById('reset-new-password').value.trim();

    const btn = document.getElementById('btn-submit-reset');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    const targetUser = adminState.users.find(u => u.id === userId);
    const data = await adminGateway('resetar_senha', {
        target_user_id: userId,
        nova_senha: novaSenha,
        target_user_nome: targetUser?.nome || ''
    });

    // Verifica se houve sucesso (n8n retorna sucesso true)
    const isSuccess = data && data.sucesso;
    if (isSuccess) {
        closeResetPasswordModal();
        showToast('Senha redefinida com sucesso!', 'success');
    } else {
        showToast('Erro ao redefinir senha do usuário.', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = 'Confirmar Reset';
}

function openEditUserModal(userId) {
    const user = adminState.users.find(u => u.id === userId);
    if (!user) return;

    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-name').value = user.nome;
    document.getElementById('edit-user-company').value = user.empresa;
    document.getElementById('edit-user-segment').value = user.segmento || 'Tecnologia';
    document.getElementById('edit-user-role').value = user.role || 'user';

    // Parse essencial_* plans: set base plan to 'essencial' and select the module
    const planSelect = document.getElementById('edit-user-plan');
    const moduloContainer = document.getElementById('edit-user-modulo-container');
    const moduloSelect = document.getElementById('edit-user-modulo-select');

    if (user.plano.startsWith('essencial_') && user.plano !== 'essencial_pendente') {
        planSelect.value = 'essencial';
        const modulo = user.plano.replace('essencial_', '');
        moduloSelect.value = modulo;
        moduloContainer.classList.remove('hidden');
        // Set radio to 'admin' mode since the module is already chosen
        const radios = document.getElementsByName('edit_modulo_mode');
        for (const r of radios) { r.checked = r.value === 'admin'; }
        moduloSelect.classList.remove('hidden');
    } else if (user.plano === 'essencial_pendente') {
        planSelect.value = 'essencial';
        moduloContainer.classList.remove('hidden');
        const radios = document.getElementsByName('edit_modulo_mode');
        for (const r of radios) { r.checked = r.value === 'client'; }
        moduloSelect.classList.add('hidden');
    } else {
        planSelect.value = user.plano;
        moduloContainer.classList.add('hidden');
    }

    document.getElementById('edit-user-status').value = user.status || 'ativo';
    document.getElementById('modal-edit-user').classList.add('active');
}

async function submitEditUser(event) {
    event.preventDefault();

    let planVal = document.getElementById('edit-user-plan').value;
    if (planVal === 'essencial') {
        let mode = 'admin';
        const radios = document.getElementsByName('edit_modulo_mode');
        for (const r of radios) { if (r.checked) mode = r.value; }

        if (mode === 'admin') {
            planVal = 'essencial_' + document.getElementById('edit-user-modulo-select').value;
        } else {
            planVal = 'essencial_pendente';
        }
    }

    const data = await adminGateway('editar_usuario', {
        target_user_id: document.getElementById('edit-user-id').value,
        usuario_id: document.getElementById('edit-user-id').value,
        nome: document.getElementById('edit-user-name').value,
        empresa: document.getElementById('edit-user-company').value,
        segmento: document.getElementById('edit-user-segment').value,
        plano: planVal,
        role: document.getElementById('edit-user-role').value,
        status: document.getElementById('edit-user-status').value
    });

    // n8n returns { sucesso } or an array with RETURNING id
    const isSuccess = data && (data.sucesso || (Array.isArray(data) && data.length > 0));
    if (isSuccess) {
        closeModal('modal-edit-user');
        showToast('Dados atualizados com sucesso!', 'success');
        loadUsers();
    } else {
        showToast('Erro ao atualizar dados.', 'error');
    }
}

async function toggleUserStatus(userId) {
    const user = adminState.users.find(u => u.id === userId);
    if (!user) return;

    const newStatus = user.status === 'ativo' ? 'inativo' : 'ativo';
    const data = await adminGateway('editar_usuario', {
        target_user_id: userId,
        usuario_id: userId,
        plano: '', // empty = keep current (COALESCE/NULLIF)
        status: newStatus
    });

    const isSuccess = data && (data.sucesso || (Array.isArray(data) && data.length > 0));
    if (isSuccess) {
        showToast(`Usuário ${newStatus === 'ativo' ? 'reativado' : 'desativado'}.`, newStatus === 'ativo' ? 'success' : 'info');
        loadUsers();
    }
}

async function deleteUser(id) {
    // 1. Confirmação de Segurança via SweetAlert2
    const result = await Swal.fire({
        title: 'Excluir Usuário',
        text: 'Todos os mapas, relatórios e dados vinculados serão apagados permanentemente. Esta ação não pode ser desfeita.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: '<i class="fa-solid fa-trash-can"></i> Sim, Excluir',
        cancelButtonText: 'Cancelar',
        background: document.documentElement.classList.contains('dark') ? '#111827' : '#fff',
        color: document.documentElement.classList.contains('dark') ? '#f1f5f9' : '#111827',
        customClass: { popup: 'swal-admin-popup' }
    });

    if (!result.isConfirmed) return;

    try {
        // 2. Disparo para o n8n (com a variável target_user_id cravada)
        const targetUser = adminState.users.find(u => u.id === id);
        const res = await adminGateway('excluir_usuario', {
            target_user_id: id,
            target_user_nome: targetUser?.nome || ''
        });

        // 3. Resposta e Atualização Visual
        if (res && res.sucesso) {
            showToast('Usuário apagado com sucesso.', 'success');
            // Recarrega a tabela para o usuário sumir da tela imediatamente
            if (adminState.currentView === 'users') {
                await loadUsers();
            }
        } else {
            showToast(res?.mensagem || 'Falha ao excluir o usuário.', 'error');
        }
    } catch (e) {
        console.error("Erro no deleteUser:", e);
        showToast('Erro de conexão com o servidor.', 'error');
    }
}

// ===== BILLING =====
async function loadBilling() {
    const data = await adminGateway('listar_billing');
    if (!data) return;
    adminState.billing = data;

    // KPIs — only count clients with fixed prices (essencial/profissional/parceiro)
    const pagantes = data.filter(d => d.valor_pago !== null && d.valor_pago > 0);
    const totalReceita = pagantes.reduce((s, d) => s + d.valor_pago, 0);
    const totalCusto = data.reduce((s, d) => s + d.custo_estimado, 0);
    const margem = totalReceita > 0 ? ((1 - totalCusto / totalReceita) * 100).toFixed(1) : '—';
    const ticketMedio = pagantes.length > 0 ? (totalReceita / pagantes.length).toFixed(0) : 0;

    document.getElementById('billing-receita').textContent = `R$ ${totalReceita.toLocaleString('pt-BR')}`;
    document.getElementById('billing-custo').textContent = `R$ ${totalCusto.toFixed(2)}`;
    document.getElementById('billing-margem').textContent = margem !== '—' ? `${margem}%` : '—';
    document.getElementById('billing-ticket').textContent = ticketMedio > 0 ? `R$ ${parseInt(ticketMedio).toLocaleString('pt-BR')}` : '—';

    // Separate paying clients from consultores/parceiros for visual grouping
    const clientes = data.filter(d => d.role !== 'consultor' && (d.plano || '') !== 'parceiro');
    const parceiros = data.filter(d => d.role === 'consultor' || (d.plano || '') === 'parceiro');

    const tbody = document.getElementById('billing-table-body');

    const renderRow = (d, isConsultor) => {
        const valorPago = d.valor_pago;
        const receitaDisplay = valorPago === null ? '<span style="color:#94a3b8;font-style:italic">A definir</span>'
            : `R$ ${valorPago.toLocaleString('pt-BR')}`;
        const roi = valorPago === null || d.diagnosticos === 0 ? '—'
            : (valorPago / Math.max(d.custo_estimado, 0.01)).toFixed(1) + 'x';
        const roiClass = valorPago !== null && valorPago > d.custo_estimado && d.diagnosticos > 0 ? 'roi-positive' : '';
        const rowStyle = isConsultor ? 'opacity:0.7;border-top:1px dashed #334155' : '';
        return `
            <tr style="${rowStyle}">
                <td class="brand">${esc(d.nome)}</td>
                <td>${esc(d.empresa)}</td>
                <td><span class="badge badge-${esc((d.plano||'').split('_')[0])}">${esc(d.plano)}</span></td>
                <td style="text-align:center;font-weight:800">${d.diagnosticos}</td>
                <td>R$ ${d.custo_estimado.toFixed(2)}</td>
                <td style="font-weight:800">${receitaDisplay}</td>
                <td class="${roiClass}" style="text-align:center">${roi}</td>
            </tr>
        `;
    };

    let html = clientes.map(d => renderRow(d, false)).join('');
    if (parceiros.length > 0) {
        html += `<tr><td colspan="7" style="padding:8px 12px;font-size:11px;color:#64748b;font-weight:600;letter-spacing:.05em;background:rgba(100,116,139,.08)">CONSULTORES / PARCEIROS</td></tr>`;
        html += parceiros.map(d => renderRow(d, true)).join('');
    }
    tbody.innerHTML = html;

    // Chart — only clients with value defined
    initBillingChart(clientes);
}

function initBillingChart(data) {
    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#1e293b' : '#e5e7eb';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    const top10 = [...data].sort((a, b) => b.valor_pago - a.valor_pago).slice(0, 10);
    const ctx = document.getElementById('chart-billing');
    if (!ctx) return;

    if (adminState.charts.billing) adminState.charts.billing.destroy();
    adminState.charts.billing = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: top10.map(d => d.empresa.length > 14 ? d.empresa.substring(0, 14) + '…' : d.empresa),
            datasets: [
                { label: 'Receita', data: top10.map(d => d.valor_pago), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 6 },
                { label: 'Custo IA', data: top10.map(d => d.custo_estimado), backgroundColor: 'rgba(239,68,68,0.5)', borderRadius: 6 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { ticks: { color: textColor, callback: v => `R$${v}` }, grid: { color: gridColor } },
                x: { ticks: { color: textColor, font: { size: 9 } }, grid: { display: false } }
            },
            plugins: { legend: { labels: { color: textColor, font: { weight: 'bold', size: 10 }, usePointStyle: true, pointStyle: 'circle' } } }
        }
    });
}

// ===== HEALTH MONITOR =====
async function loadHealth() {
    const data = await adminGateway('listar_health');
    if (!data || !Array.isArray(data)) return;
    adminState.health = data;
    renderHealthCards(data);
}

function filterHealth(level, btnElement) {
    document.querySelectorAll('#health-filters .filter-btn').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    let filtered = [...adminState.health];
    if (level === 'critical') filtered = filtered.filter(h => h.score_global < 40);
    else if (level === 'warning') filtered = filtered.filter(h => h.score_global >= 40 && h.score_global <= 60);
    else if (level === 'healthy') filtered = filtered.filter(h => h.score_global > 60);

    renderHealthCards(filtered);
}

function renderHealthCards(data) {
    const container = document.getElementById('health-cards-container');
    if (!container) return;

    const sorted = [...data].sort((a, b) => (a.score_global || 0) - (b.score_global || 0));

    if (sorted.length === 0) {
        container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:3rem"><i class="fa-solid fa-heart-pulse" style="font-size:2rem;color:var(--text-muted)"></i><p style="margin-top:1rem;color:var(--text-muted);font-weight:700">Nenhum dado de saúde disponível.</p></div>';
        return;
    }

    container.innerHTML = sorted.map(h => {
        const score = h.score_global || 0;
        const level = score < 40 ? 'critical' : score <= 60 ? 'warning' : 'healthy';
        const levelLabel = level === 'critical' ? '🔴 Crítico' : level === 'warning' ? '🟡 Atenção' : '🟢 Saudável';
        const modulos = Array.isArray(h.modulos) ? h.modulos : [];
        const gargalo = h.gargalo || 'N/A';

        return `
            <div class="health-card ${level}">
                <div class="health-stripe"></div>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:0.5rem">
                    <div>
                        <p style="font-weight:900;font-size:1.15rem;letter-spacing:-0.02em">${esc(h.empresa)}</p>
                        <p style="font-size:0.65rem;color:var(--text-muted);font-weight:700;margin-top:0.3rem">${levelLabel}</p>
                    </div>
                    <div class="health-score ${level}">${score}</div>
                </div>
                <div style="margin-top:1.25rem">
                    <p style="font-size:0.6rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.15em;margin-bottom:0.3rem">Gargalo Principal</p>
                    <p style="font-weight:800;color:#ef4444;font-size:0.9rem">${esc(gargalo)}</p>
                </div>
                ${modulos.length > 0 ? `<div class="health-meta">${modulos.map(m => `<span class="health-tag">${esc(m)}</span>`).join('')}</div>` : ''}
                <div style="margin-top:1.25rem;display:flex;align-items:center;justify-content:space-between">
                    <span style="font-size:0.6rem;color:var(--text-muted);font-weight:700">${h.ultima_analise ? new Date(h.ultima_analise).toLocaleDateString('pt-BR') : '--'}</span>
                    ${level === 'critical' ? `<button class="action-btn brand" data-uid="${esc(h.usuario_id)}" data-empresa="${esc(h.empresa)}" data-score="${Number(score)||0}" onclick="handleOfferClick(this)"><i class="fa-solid fa-paper-plane"></i> Enviar Oferta</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// ===== OFFER MODAL =====
function openOfferModal(userId, empresa, score) {
    document.getElementById('offer-user-id').value = userId;
    document.getElementById('offer-empresa-name').textContent = empresa;
    document.getElementById('offer-score-value').textContent = score;

    const preview = document.getElementById('offer-preview');
    preview.innerHTML = `
        <strong>Prezado(a) cliente ${empresa},</strong><br><br>
        Identificamos que sua organização apresenta um score de saúde de <strong>${score}/100</strong> em nosso diagnóstico GIIF, 
        indicando oportunidades significativas de melhoria.<br><br>
        Gostaríamos de oferecer nosso <strong>Plano Premium com Consultoria Ativa</strong>, onde um consultor especializado 
        acompanhará de perto a evolução do seu cenário estratégico, com reuniões semanais e planos de ação personalizados.<br><br>
        <em>— Equipe GIIF</em>
    `;

    document.getElementById('modal-offer').classList.add('active');
}

async function submitOffer() {
    const userId = document.getElementById('offer-user-id').value;
    const msg = document.getElementById('offer-message').value || document.getElementById('offer-preview').textContent;

    const data = await adminGateway('enviar_oferta', {
        usuario_id: userId,
        tipo_oferta: 'premium_consultoria',
        mensagem: msg
    });

    if (data && data.sucesso) {
        closeModal('modal-offer');
        showToast('Oferta enviada com sucesso!', 'success');
    } else {
        showToast('Erro ao enviar oferta.', 'error');
    }
}

// ===== CONSULTANTS =====
async function loadConsultants() {
    const data = await adminGateway('listar_consultores');
    if (!data) return;
    adminState.consultants = Array.isArray(data) ? data : [];
    renderConsultantCards(adminState.consultants);
}

function renderConsultantCards(data) {
    const container = document.getElementById('consultants-container');
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem"><i class="fa-solid fa-user-tie" style="font-size:2rem;color:var(--text-muted)"></i><p style="margin-top:1rem;color:var(--text-muted);font-weight:700">Nenhum consultor cadastrado.</p></div>';
        return;
    }

    container.innerHTML = data.map(c => {
        const clienteNomes = Array.isArray(c.clientes) ? c.clientes.filter(Boolean) : [];
        const clienteIds = Array.isArray(c.clientes_ids) ? c.clientes_ids.filter(Boolean) : [];
        const totalVinculados = c.qtd_clientes || Math.max(clienteNomes.length, clienteIds.length);
        const isPartner = !!c.is_parceiro;

        let tagsHtml = '';
        if (clienteNomes.length > 0) {
            tagsHtml = `<div style="display:flex;flex-wrap:wrap;gap:0.35rem">${clienteNomes.map(cl => `<span class="health-tag" style="background:var(--brand-50);color:var(--brand-600);border:1px solid rgba(59,85,230,0.15)"><i class="fa-solid fa-building" style="font-size:0.45rem;margin-right:0.2rem"></i>${esc(cl)}</span>`).join('')}</div>`;
        } else if (totalVinculados > 0) {
            tagsHtml = `<p style="font-size:0.7rem;color:var(--brand-500);font-weight:700"><i class="fa-solid fa-link" style="margin-right:0.3rem"></i>${totalVinculados} empresa${totalVinculados !== 1 ? 's' : ''} vinculada${totalVinculados !== 1 ? 's' : ''} — clique em Editar para ver detalhes</p>`;
        } else {
            tagsHtml = '<p style="font-size:0.7rem;color:var(--text-muted);font-style:italic">Nenhuma empresa vinculada ainda.</p>';
        }

        return `
        <div class="consultant-card">
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem">
                <div class="consultant-avatar" style="margin-bottom:0">${c.nome.split(' ').map(n => n[0]).slice(0, 2).join('')}</div>
                <div style="flex:1;min-width:0">
                    <p class="consultant-name" style="margin-bottom:0">
                        ${esc(c.nome)}
                        ${isPartner ? '<span class="badge-partner"><i class="fa-solid fa-star"></i> Parceiro</span>' : ''}
                    </p>
                    <p class="consultant-email">${esc(c.email)}</p>
                </div>
            </div>
            <span class="consultant-specialty">${esc(c.especialidade) || 'N/A'}</span>
            <div class="consultant-clients">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
                    <span><i class="fa-solid fa-briefcase" style="margin-right:0.3rem"></i> <strong>${totalVinculados}</strong> cliente${totalVinculados !== 1 ? 's' : ''} vinculado${totalVinculados !== 1 ? 's' : ''}</span>
                    <button class="action-btn brand" data-cid="${esc(c.id)}" data-nome="${esc(c.nome)}" onclick="handleEditConsultantLinksClick(this)" title="Editar Vínculos" style="font-size:0.55rem;padding:0.3rem 0.6rem">
                        <i class="fa-solid fa-link"></i> Editar
                    </button>
                </div>
                ${tagsHtml}
            </div>
        </div>
    `;
    }).join('');
}

function openCreateConsultantModal() {
    document.getElementById('modal-create-consultant').classList.add('active');
    document.getElementById('create-consultant-form').reset();

    // Load companies as checkboxes
    const companiesContainer = document.getElementById('new-consultant-companies');
    const userClients = adminState.users.filter(u => u.role === 'user');

    if (userClients.length === 0) {
        companiesContainer.innerHTML = '<div style="text-align:center; padding: 1rem; color: var(--text-muted); font-size: 0.75rem;">Nenhuma empresa (usuário) cadastrada no sistema.</div>';
    } else {
        companiesContainer.innerHTML = userClients.map(u => `
            <label class="checkbox-item">
                <input type="checkbox" name="consultant_companies" value="${u.id}">
                <div class="company-info">
                    <span class="company-name">${esc(u.empresa) || esc(u.nome)}</span>
                    <span class="company-segment">${esc(u.segmento) || 'Empresa'}</span>
                </div>
            </label>
        `).join('');
    }
}

async function submitCreateConsultant(event) {
    event.preventDefault();
    const form = event.target;

    const btn = document.getElementById('btn-submit-consultant');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cadastrando...';

    // Coleta empresas selecionadas
    const checkboxes = form.querySelectorAll('input[name="consultant_companies"]:checked');
    const empresasIds = Array.from(checkboxes).map(cb => cb.value);

    // O envio é feito para a porta 3000 do próprio gateway via fetch na adminGateway
    const data = await adminGateway('criar_consultor', {
        nome: form.querySelector('#new-consultant-name').value.trim(),
        email: form.querySelector('#new-consultant-email').value.trim(),
        senha: form.querySelector('#new-consultant-password').value.trim(),
        especialidade: form.querySelector('#new-consultant-specialty').value.trim(),
        is_parceiro: form.querySelector('#new-consultant-partner').checked,
        empresas_ids: empresasIds
    });

    if (data && data.sucesso) {
        closeModal('modal-create-consultant');
        showToast('Consultor cadastrado com sucesso!', 'success');
        loadConsultants();
    } else {
        showToast('Erro ao cadastrar consultor.', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Cadastrar Consultor';
}

// ===== EDIT CONSULTANT LINKS =====
async function openEditConsultantLinksModal(consultantId, consultantName) {
    const consultant = adminState.consultants.find(c => String(c.id) === String(consultantId));
    if (!consultant) {
        showToast('Consultor não encontrado na lista.', 'error');
        return;
    }

    document.getElementById('edit-consultant-id').value = consultantId;
    document.getElementById('edit-consultant-link-name').textContent = consultantName || consultant.nome;

    const companiesContainer = document.getElementById('edit-consultant-companies');
    companiesContainer.innerHTML = '<div style="text-align:center; padding: 1rem;"><i class="fa-solid fa-spinner fa-spin" style="color:var(--brand-500)"></i></div>';
    document.getElementById('modal-edit-consultant-links').classList.add('active');

    // Garantir que a lista de usuários esteja carregada
    if (!adminState.users || adminState.users.length === 0) {
        const usersData = await adminGateway('listar_usuarios');
        if (usersData) adminState.users = usersData;
    }

    // Filtra apenas usuários com role 'user' (clientes)
    const userClients = adminState.users.filter(u => u.role === 'user' || u.role === undefined);

    // IDs já vinculados — parsePostgresArray já foi aplicado no normalizer
    const linkedIds = Array.isArray(consultant.clientes_ids)
        ? consultant.clientes_ids.filter(Boolean).map(String)
        : [];

    // Debug log suppressed in production (VULN #11)
    if (location.hostname === 'localhost') console.log('[EditLinks] Consultor:', consultant.nome, '| vinc:', linkedIds.length, '| disp:', userClients.length);

    if (userClients.length === 0) {
        companiesContainer.innerHTML = '<div style="text-align:center; padding: 1.5rem; color: var(--text-muted); font-size: 0.75rem;"><i class="fa-solid fa-info-circle" style="margin-right:0.3rem"></i> Nenhuma empresa (usuário cliente) cadastrada no sistema.</div>';
    } else {
        companiesContainer.innerHTML = userClients.map(u => {
            const empresaName = u.empresa || u.nome || 'Sem nome';
            const isLinked = linkedIds.includes(String(u.id));
            return `
                <label class="checkbox-item">
                    <input type="checkbox" name="edit_consultant_companies" value="${u.id}" ${isLinked ? 'checked' : ''}>
                    <div class="company-info">
                        <span class="company-name">${esc(empresaName)}</span>
                        <span class="company-segment">${esc(u.segmento) || 'Empresa'}</span>
                    </div>
                </label>
            `;
        }).join('');
    }
}

async function submitEditConsultantLinks(event) {
    event.preventDefault();
    const btn = document.getElementById('btn-submit-edit-links');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

    const consultantId = document.getElementById('edit-consultant-id').value;
    const checkboxes = document.querySelectorAll('#edit-consultant-companies input[name="edit_consultant_companies"]:checked');
    const empresasIds = Array.from(checkboxes).map(cb => cb.value);

    const data = await adminGateway('editar_vinculos_consultor', {
        consultor_id: consultantId,
        empresas_ids: empresasIds
    });

    if (data && (data.sucesso || data.id)) {
        closeModal('modal-edit-consultant-links');
        showToast('Vínculos atualizados com sucesso!', 'success');
        loadConsultants();
    } else {
        showToast('Erro ao atualizar vínculos. Verifique o backend.', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Salvar Vínculos';
}

// ===== UTILS =====
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function toggleAdminTheme() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('admin_theme', isDark ? 'dark' : 'light');

    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.classList.remove('fa-moon', 'fa-sun');
        icon.classList.add(isDark ? 'fa-sun' : 'fa-moon');
    }

    // Redraw charts
    if (adminState.currentView === 'dashboard') loadDashboard();
    else if (adminState.currentView === 'billing') loadBilling();
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type]}" style="color:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : 'var(--brand-500)'}"></i> ${esc(message)}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(30px)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ===== TICKETS / HELPDESK =====
let ticketFilterStatus = 'all';
let ticketSearchQuery = '';

async function loadTickets() {
    const data = await adminGateway('listar_tickets_admin');
    if (!data) return;

    // Fallback in case of object wrapped array or missing data
    if (Array.isArray(data) && Array.isArray(data[0])) adminState.tickets = data[0];
    else if (Array.isArray(data)) adminState.tickets = data;
    else adminState.tickets = [];

    // Atualiza a badge do menu também
    const abertos = adminState.tickets.filter(t => t.status === 'Aberto').length;
    const badge = document.getElementById('sidebar-ticket-badge');
    if (badge) {
        if (abertos > 0) {
            badge.innerText = abertos > 5 ? '5+' : abertos;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    renderTicketsTable();
}

function filterTickets(status, btnElement) {
    ticketFilterStatus = status;
    document.querySelectorAll('#ticket-status-filters .filter-btn').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    renderTicketsTable();
}

function searchTickets(query) {
    ticketSearchQuery = query.toLowerCase();
    renderTicketsTable();
}

function renderTicketsTable() {
    const tbody = document.getElementById('tickets-table-body');
    if (!tbody) return;

    let filtered = adminState.tickets;

    if (ticketFilterStatus !== 'all') {
        filtered = filtered.filter(t => t.status === ticketFilterStatus);
    }
    if (ticketSearchQuery) {
        filtered = filtered.filter(t =>
            (t.assunto || '').toLowerCase().includes(ticketSearchQuery) ||
            (t.empresa || '').toLowerCase().includes(ticketSearchQuery) ||
            (t.usuario_email || '').toLowerCase().includes(ticketSearchQuery)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;">Nenhum ticket encontrado.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(t => {
        let badgeClass = 'bg-slate';
        if (t.status === 'Aberto') badgeClass = 'bg-amber';
        if (t.status === 'Respondido') badgeClass = 'bg-brand';
        if (t.status === 'Fechado') badgeClass = 'bg-emerald';

        const tDate = t.data_criacao || t.created_at || t.data || t.timestamp;
        const dateString = tDate ? new Date(tDate).toLocaleDateString() : new Date().toLocaleDateString();

        return `
            <tr>
                <td><span class="plan-badge ${badgeClass}">${esc(t.status) || 'N/A'}</span></td>
                <td>${dateString}</td>
                <td>
                    <div style="font-weight:900;color:var(--text-main)">${esc(t.empresa) || 'Empresa Desconhecida'}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted)">${esc(t.usuario_email) || ''}</div>
                </td>
                <td style="font-weight:bold;max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(t.assunto)}">
                    ${esc(t.assunto)}
                </td>
                <td style="text-align:right">
                    <button class="action-btn" data-tid="${esc(t.id)}" onclick="handleTicketClick(this)">
                        <i class="fa-solid fa-reply"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function openTicketModal(ticketId) {
    const t = adminState.tickets.find(x => String(x.id) === String(ticketId));
    if (!t) return;

    document.getElementById('ticket-id').value = t.id;
    document.getElementById('ticket-admin-assunto').textContent = t.assunto;
    document.getElementById('ticket-admin-empresa').textContent = t.empresa + " (" + t.usuario_email + ")";
    document.getElementById('ticket-admin-categoria').textContent = t.categoria;
    document.getElementById('ticket-admin-mensagem').textContent = t.mensagem;

    const statusBadge = document.getElementById('ticket-admin-status');
    statusBadge.textContent = t.status;
    statusBadge.className = 'plan-badge ' + (t.status === 'Aberto' ? 'bg-amber' : (t.status === 'Respondido' ? 'bg-brand' : 'bg-emerald'));

    // Limpar formulário de resposta anterior
    document.getElementById('ticket-admin-resposta').value = t.resposta_admin || '';
    document.getElementById('ticket-admin-action').value = t.status === 'Fechado' ? 'Fechado' : 'Respondido';

    document.getElementById('modal-ticket-admin').classList.add('active');
}

async function submitTicketResponse(event) {
    event.preventDefault();
    const btn = document.getElementById('btn-submit-ticket-response');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Respondendo...';

    const id = document.getElementById('ticket-id').value;
    const resposta_admin = document.getElementById('ticket-admin-resposta').value;
    const status = document.getElementById('ticket-admin-action').value;

    try {
        const res = await adminGateway('responder_ticket', { ticket_id: id, id, resposta_admin, status });
        if (res) {
            showToast('Ticket respondido com sucesso!', 'success');
            closeModal('modal-ticket-admin');
            await fetchTicketBadge();
            if (adminState.currentView === 'tickets') {
                await loadTickets();
            }
        } else {
            showToast('Falha ao responder ticket.', 'error');
        }
    } catch (e) {
        showToast('Erro de conexão', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Resposta';
    }
}

// ===== LOGS DE ATIVIDADE =====
window._logsPage = 1;
const EVENTO_LABELS = {
    'login_usuario':    'Login (Usuário)',
    'login_consultor':  'Login (Consultor)',
    'login_admin':      'Login (Admin)',
    'usuario_criado':   'Usuário Criado',
    'usuario_editado':  'Usuário Editado',
    'usuario_excluido': 'Usuário Excluído',
    'senha_resetada':   'Senha Resetada',
};
const PAPEL_BADGE = { admin: 'badge-admin', consultor: 'badge-partner', usuario: 'badge-essencial' };

async function loadLogs(page = 1) {
    page = Math.max(1, page);
    window._logsPage = page;
    const limite = 25;
    const offset  = (page - 1) * limite;
    const tipo    = document.getElementById('log-filter-tipo')?.value || null;
    const inicio  = document.getElementById('log-filter-inicio')?.value || null;
    const fim     = document.getElementById('log-filter-fim')?.value || null;

    const tbody = document.getElementById('logs-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Carregando...</td></tr>';

    const raw = await adminGateway('listar_logs_atividade', {
        limite, offset,
        tipo_evento:  tipo   || undefined,
        data_inicio:  inicio || undefined,
        data_fim:     fim    || undefined,
    });

    const logs = Array.isArray(raw) ? raw : [];
    renderLogs(logs);

    const prevBtn = document.getElementById('log-btn-prev');
    const nextBtn = document.getElementById('log-btn-next');
    const pageInfo = document.getElementById('log-page-info');
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = logs.length < limite;
    if (pageInfo) pageInfo.textContent = `Página ${page}`;
}

function renderLogs(logs) {
    const tbody = document.getElementById('logs-table-body');
    if (!tbody) return;

    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nenhum registro encontrado.</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(l => {
        const dt     = l.criado_em ? new Date(l.criado_em).toLocaleString('pt-BR') : '---';
        const evento = EVENTO_LABELS[l.tipo_evento] || l.tipo_evento || '---';
        const papel  = l.ator_papel || '';
        const badge  = PAPEL_BADGE[papel] || '';
        const alvo   = esc(l.alvo_nome || l.alvo_id || '---');
        const det    = l.metadados ? esc(JSON.stringify(l.metadados)) : '---';
        return `<tr>
            <td style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap">${esc(dt)}</td>
            <td>${esc(l.ator_nome || l.ator_id || '---')}${papel ? ` <span class="badge ${badge}" style="font-size:0.6rem;vertical-align:middle">${esc(papel)}</span>` : ''}</td>
            <td><span class="badge" style="background:var(--brand-primary-alpha,rgba(99,102,241,.12));color:var(--brand-500,#6366f1);font-size:0.7rem">${esc(evento)}</span></td>
            <td style="font-size:0.8rem">${alvo}</td>
            <td style="font-size:0.7rem;color:var(--text-muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${det}">${det}</td>
        </tr>`;
    }).join('');
}

/* ============================================================
   NOTA PARA DESENVOLVEDORES — Blindagem Visual (Tarefa 4)
   ============================================================
   A função extractCleanText(data) acima resolve o bug de "Double JSON"
   onde relatorio_texto chega ao front-end como string JSON bruta com
   chaves { } visíveis, quebrando a renderização Markdown.

   COMO USAR em qualquer função que consuma relatorio_texto:
   
     const rawData = await fetch(...).then(r => r.json());
     const safeData = extractCleanText(rawData);
     if (safeData && safeData.relatorio_texto) {
       const html = marked.parse(safeData.relatorio_texto);
       element.innerHTML = DOMPurify.sanitize(html);
     }

   Em index.html, aplique em:
   - enviarParaIA()        → wrapping de processarRespostaIA()
   - aprofundarAnalise()   → wrapping de processarRespostaIA()
   - gerarDiagnosticoGlobal() → wrapping de processarRespostaIA()
   ============================================================ */
