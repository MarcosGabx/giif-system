# GIIF System — Escopo Completo do Projeto
> Documento de handoff para continuidade de desenvolvimento, correções e melhorias.
> Última atualização: 2026-06-23

---

## 1. Visão Geral do Produto

O **GIIF System** é uma plataforma SaaS B2B de análise empresarial orientada por IA consultiva. Funciona como um "Sócio-Diretor de IA" que analisa dados empresariais em múltiplas camadas de profundidade, entregando diagnósticos executivos personalizados para empresários, gestores e consultores.

**Domínio de produção:** `https://giifsystem.com.br` (Netlify)
**API backend:** `https://giif-api.duckdns.org` (n8n self-hosted)

---

## 2. Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend (usuário) | HTML5 + TailwindCSS (CDN) + Vanilla JS + Chart.js + Marked.js + DOMPurify + html2pdf |
| Frontend (admin) | HTML5 + CSS customizado + Vanilla JS + Chart.js + SweetAlert2 |
| Orquestrador IA | n8n self-hosted v2.15.0 (`giif-api.duckdns.org`) |
| IA principal | Anthropic Claude — Haiku 4.5 (normalizadores C1) / Sonnet 4.6 (análises C2/C3 e PDF) |
| Banco de dados | PostgreSQL (via n8n nodes nativos) |
| Hospedagem frontend | Netlify (com `_headers` para CSP/HSTS) |
| Proxy reverso | Netlify Functions para rotas `/api/*` com timeout 10s; fetch direto ao n8n para IA (timeout 180s) |
| Auth | JWT HS256 manual implementado em Code nodes n8n (crypto.createHmac) |

---

## 3. Estrutura de Arquivos

```
giif_system-main/
├── index.html              # Frontend SPA do usuário (~4.886 linhas, ~271KB)
├── admin.html              # Painel administrativo (~50KB)
├── css/
│   └── admin.css           # Estilos do admin (~29KB)
├── js/
│   └── admin.js            # Lógica do admin (~60KB, ~1.400 linhas)
├── _headers                # Cabeçalhos de segurança Netlify (CSP, HSTS, X-Frame-Options)
├── netlify.toml            # Config de redirecionamento Netlify (proxy /api/* → n8n)
└── PROJECT_SCOPE.md        # Este arquivo
```

**Arquivos n8n (fora do repo — em Downloads do usuário):**
- `C:\Users\marco\Downloads\GIIF - Gateway Master Update (Corrigido) (6).json` — **ATIVO EM PRODUÇÃO**
- `C:\Users\marco\Downloads\GIIF - Motor 3 Camadas (Inicial, Premium, Global) 23-05-2026.json` — Motor IA em produção
- `C:\Users\marco\Downloads\GIIF - Gateway Completo (Prod) (6).json` — versão completa

---

## 4. Arquitetura do Sistema

### 4.1 Fluxo de Autenticação

```
Frontend → POST /api-login (Netlify proxy → n8n /api-login)
         ← JWT (HS256, 7 dias) + dados do usuário

Frontend → Armazena em:
           sessionStorage: giif_user_token (JWT)
           localStorage: giif_user_id, giif_user_role, giif_user_plano,
                         giif_user_nome, giif_user_empresa, giif_user_segmento,
                         giif_user_is_parceiro

Admin    → POST /api-admin-gateway { acao: 'admin_login', email, senha }
         ← JWT admin + admin_id
           sessionStorage: giif_admin_token, giif_admin_id, giif_admin_nome
```

**IMPORTANTE — Limitação n8n 2.15.0:** `process.env`, `$env` e `$vars` são todos bloqueados em Code nodes. O JWT secret (`bJgnt1ruudNiWMFLyU6DHZkIcwNNNka1RkwWm4QHpys=`) está hardcoded nos 7 nós de Code do Gateway. Nunca usar `process.env` — vai falhar silenciosamente.

### 4.2 Gateway Master (n8n)

Arquivo: `GIIF - Gateway Master Update (Corrigido) (6).json`

Endpoints (todos `POST`):

| Endpoint | Autenticação | Descrição |
|---|---|---|
| `/api-login` | Nenhuma | Login de usuário, retorna JWT |
| `/api-cadastro` | Nenhuma | Registro de novo usuário |
| `/api-atualizar-perfil` | JWT | Atualiza empresa/segmento/senha |
| `/api-documentos` | JWT | Lista relatórios com texto completo |
| `/api-documentos2` | JWT | Lista relatórios sem texto (metadata) |
| `/api-gateway` | JWT | Gateway principal do cliente (ações: salvar_mapa, carregar_mapas, abrir_ticket, listar_tickets_cliente, excluir_mapa, listar_lobby_consultor, desvincular_consultor_empresa) |
| `/api-admin-gateway` | JWT (deve ser admin) | Gateway admin (18 ações — ver seção 4.4) |

**Nós de validação JWT (5 cópias do mesmo código):**
- `Validador JWT Perfil` — para `/api-atualizar-perfil`
- `Validador JWT Doc 1` — para `/api-documentos`
- `Validador JWT Doc 2` — para `/api-documentos2`
- `Validador JWT Cliente` — para `/api-gateway`
- `Validador JWT Admin` — para `/api-admin-gateway`

**Todos os validadores** sobrescrevem `item.body.usuario_id = payloadObj.usuario_id` **EXCETO** o Admin (corrigido em 2026-06-22 para `if (!item.body.usuario_id) item.body.usuario_id = payloadObj.usuario_id`).

### 4.3 Motor de IA — 3 Camadas

Arquivo: `GIIF - Motor 3 Camadas (Inicial, Premium, Global) 23-05-2026.json` (v9.0)

**Camada 1 — Diagnóstico Inicial:**
- Webhooks: `/api-analisar-{estrategico|financeiro|comercial|marketing|pessoas}`
- Input: FormData (dados empresa + contexto + arquivos)
- Processamento: Preparar Variáveis → Validar Permissões (PostgreSQL) → Processar Anexos (loop) → IA Módulo (Haiku) → Normalizador (Haiku) → Calculadora Determinística → Salvar PostgreSQL → Retornar
- Parser JSON: v9.0 "Ultra-Safe" com 3 passes + fallback (já robusto)

**Camada 2 — Aprofundamento Premium:**
- Webhook: `/api-analise-aprofundada`
- Input: JSON (usuario_id + modulo + relatorio_anterior + contexto)
- IA: Claude Sonnet 4.6
- Retry automático: 2 tentativas

**Camada 3 — Diagnóstico Global Enterprise:**
- Webhook: `/api-analise-global`
- Input: JSON (usuario_id)
- IA: Claude Sonnet 4.6
- Cruza TODOS os relatórios C1 do usuário

### 4.4 Ações do Admin Gateway

```
login, listar_usuarios, editar_usuario, dashboard_completo, criar_usuario,
listar_health, listar_billing, listar_consultores, criar_consultor,
atribuir_consultor, resetar_senha, listar_tickets_admin, responder_ticket,
excluir_usuario, listar_lobby_consultor, desvincular_consultor_empresa,
editar_vinculos_consultor, validar_sessao
```

### 4.5 Estrutura de Planos

| Plano | Preço | Acesso |
|---|---|---|
| Parceiro | R$0 | Tudo (consultor/parceiro) |
| Essencial | R$197/mês | 1 módulo fixo (escolhido no onboarding) |
| Profissional | R$397/mês | Todos módulos C1 + C2 |
| Enterprise | Custom | Tudo + C3 Diagnóstico Global |

Módulos: `estrategico` | `financeiro` | `comercial` | `marketing` | `pessoas`

---

## 5. Banco de Dados (PostgreSQL)

Tabelas inferidas do workflow:

```sql
usuarios_giif (
    id, nome_completo, email, senha_hash, nome_empresa, segmento,
    plano, role, status, is_parceiro, ultimo_acesso, created_at
)

relatorios_ia (
    id, usuario_id, modulo, tipo_analise (c1/c2/c3),
    relatorio_texto, scores (JSONB), dados_normalizados (JSONB),
    data_geracao
)

tickets_suporte (
    id, usuario_id, assunto, categoria, mensagem, status,
    resposta_admin, data_criacao, data_atualizacao
)

mapas_estrategicos (
    usuario_id (PK), mapa_json (JSONB), atualizado_em
)

mapas_projetos (
    id (TEXT PK), usuario_id, nome_mapa, mapa_json (JSONB),
    data_criacao, data_atualizacao
)

consultor_clientes (
    consultor_id, usuario_id,
    PRIMARY KEY (consultor_id, usuario_id)
)

rate_limits (  -- criado em 2026-06-22, ainda NÃO implementado nos workflows
    identifier TEXT,
    endpoint TEXT,
    window_start TIMESTAMPTZ,
    request_count INT,
    PRIMARY KEY (identifier, endpoint, window_start)
)
```

---

## 6. Estado Atual das Correções de Segurança

### 6.1 Vulnerabilidades CONCLUÍDAS

| ID | Descrição | Arquivo | Data |
|---|---|---|---|
| VULN-01 | JWT HS256 implementado (era MD5/Base64) | Gateway (6).json | Sessão anterior |
| VULN-02 | XSS onclick → data-* pattern | admin.js | Já estava corrigido |
| VULN-05 | CORS placeholder → giifsystem.com.br (35 ocorrências) | Gateway (6).json | 2026-06-22 |
| VULN-06 | CSRF header X-Requested-With em todas as requisições | admin.js + index.html | 2026-06-22 |
| VULN-07 | Admin token em sessionStorage (era localStorage) | admin.js | Já estava corrigido |
| VULN-10 | HSTS header no _headers | _headers | Já estava correto |
| BUG-01 | `editar_usuario` editava o admin em vez do target | Gateway (6).json — Validador JWT Admin | 2026-06-22 |
| BUG-02 | `ultimo_acesso` mostrava data atual para todos (fallback JS) | admin.js + Gateway (6).json | 2026-06-23 |

### 6.2 Vulnerabilidades PENDENTES — Por Prioridade

#### CRÍTICO (implementar imediatamente)

**C-01 — Validador JWT Admin não verifica role**
- **Arquivo:** Gateway (6).json — nó `Validador JWT Admin` (id: `7657d304-8737-4333-a34d-62c0e7abcd0d`)
- **Problema:** O nó valida a assinatura JWT mas não verifica `payloadObj.role === 'admin'`. Qualquer usuário autenticado (role='user') pode chamar endpoints admin.
- **Fix:** Após `const payloadObj = JSON.parse(...)`, adicionar:
  ```javascript
  if (payloadObj.role !== 'admin' && payloadObj.role !== 'consultor') {
      return { jwt_valido: false, erro: 'Acesso restrito a administradores.' };
  }
  ```

**C-02 — SQL Injection em 2 queries do Gateway**
- **Arquivo:** Gateway (6).json
- **Nó "DB: Listar Lobby"** — usa `'{{ $json.body.usuario_id }}'` diretamente na SQL
- **Nó "DB: Salvar Vinculo Consultor"** — usa `{{$json.consultor_id}}, {{$json.empresa_id}}` sem queryReplacement
- **Fix:** Converter para `$1, $2` com `queryReplacement` parametrizado (padrão do restante das queries)

**C-03 — adminLogin não valida role na resposta**
- **Arquivo:** admin.js linha 344
- **Problema:** `const isSuccess = data && (data.sucesso === true || data.id)` — aceita qualquer conta com `data.id`
- **Fix:**
  ```javascript
  const isAdmin = data && data.sucesso === true && data.token
                  && (data.role === 'admin' || data.role === 'consultor');
  ```

#### ALTO (esta sprint)

**A-01 — CORS `allowedOrigins: "*"` nos 7 webhooks**
- Todos os webhooks aceitam requests de qualquer origem
- **Fix:** Trocar `"allowedOrigins": "*"` por `"allowedOrigins": "https://giifsystem.com.br"` nos 7 webhooks

**A-02 — `/api-cadastro` sem rate limiting**
- Bot pode criar milhares de contas, enumerar emails, spam o banco
- **Fix:** Aplicar rate limiting (5 req/min por IP) com o SQL já criado para `rate_limits`

**A-03 — XSS em offer preview**
- **Arquivo:** admin.js linha 957
- `${empresa}` e `${score}` sem `esc()` em `preview.innerHTML`
- **Fix:** Envolver com `esc(empresa)` e `esc(String(score))`

**A-04 — `usuario_id` em localStorage manipulável**
- **Arquivo:** index.html linha 2996
- Frontend envia `usuario_id` do localStorage; usuário pode adulterá-lo para salvar relatórios com ID alheio
- **Fix:** Backend (Motor n8n) deve usar `usuario_id` extraído do JWT (`payloadObj.usuario_id`), nunca o enviado pelo cliente

**A-05 — Error handling silenciado**
- **Arquivo:** index.html linhas 2410, 3287 — `catch (e) { }` vazio
- Falhas de rede em notificações e documentos são silenciosas

**A-06 — Sem auditoria de ações admin destrutivas**
- Nenhum registro de quem executou `excluir_usuario`, `resetar_senha`, `editar_usuario`
- **Fix:** Criar tabela `audit_log` e inserir registro após cada ação destrutiva

#### MÉDIO (próximas sprints)

**VULN-11 — Rate limiting (parcialmente planejado)**
- SQL da tabela `rate_limits` definido mas NÃO implementado nos workflows ainda
- Limites planejados: Login 5/min por IP, Gateway 30/min por user_id, Motor 10/min por user_id
- Ver seção 7 para código completo

**VULN-03 — Roles sensíveis em localStorage**
- `giif_user_role`, `giif_user_plano`, `giif_user_is_parceiro` em localStorage
- Manipulação causa bypass de UI (não de API, pois servidor re-valida via banco)
- **Fix parcial:** Mover para sessionStorage; **Fix completo:** Eliminar e buscar sempre do servidor

**VULN-04 — CSP `unsafe-inline` e `unsafe-eval`**
- **Arquivo:** `_headers`
- Requer refatoração de todo JS inline do index.html para arquivos externos
- **Esforço:** Alto — envolve mover ~2.600 linhas de JS inline

**M-01 — 9 chamadas fetch sem timeout**
- index.html linhas 2397, 2420, 2467, 2581, 2685, 2720, 2791, 2868, 2908
- Adicionar `AbortController` com timeout de 15s

**M-02 — Sem retry em Camada 1 e 3**
- Apenas Camada 2 tem retry automático (MAX_TENTATIVAS = 2)
- Camadas 1 e 3 falham sem retry

**M-03 — Sem progress bar para operações longas**
- Análise IA pode levar até 180s — usuário só vê spinner estático
- Adicionar contador de segundos decorridos

**M-04 — Código JWT duplicado em 5 nós**
- Manutenção custosa: bug precisa ser corrigido em 5 lugares
- Usar n8n `Execute Workflow` como sub-rotina

**M-05 — marked.js sem versão pinned**
- `https://cdn.jsdelivr.net/npm/marked/marked.min.js` (sem versão)
- Fixar em `@9.1.6` ou versão específica

**M-06 — Token JWT com TTL de 7 dias**
- Muito longo — reduzir para 24h + implementar refresh token
- Logout não invalida token no servidor (sem blacklist)

---

## 7. Rate Limiting — Implementação Planejada (Pendente)

### SQL (executar uma vez no PostgreSQL)
```sql
CREATE TABLE IF NOT EXISTS rate_limits (
    identifier    TEXT        NOT NULL,
    endpoint      TEXT        NOT NULL,
    window_start  TIMESTAMPTZ NOT NULL DEFAULT DATE_TRUNC('minute', NOW()),
    request_count INT         NOT NULL DEFAULT 1,
    PRIMARY KEY (identifier, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup
    ON rate_limits (window_start);
```

### Query reutilizável (nó Postgres — mesmo para todos os endpoints)
```sql
WITH cleanup AS (
  DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '10 minutes'
),
upsert AS (
  INSERT INTO rate_limits (identifier, endpoint, window_start, request_count)
  VALUES ('{{ $json.identifier }}', '{{ $json.endpoint }}', DATE_TRUNC('minute', NOW()), 1)
  ON CONFLICT (identifier, endpoint, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING request_count
)
SELECT request_count FROM upsert;
```

### Limites por endpoint
| Endpoint | Identificador | Limite | Proteção |
|---|---|---|---|
| `login` | IP (`x-forwarded-for`) | 5/min | Brute force |
| `gateway` | user_id (do JWT) | 30/min | Abuso de API |
| `motor` | user_id (do JWT) | 10/min | Custo GPT |
| `cadastro` | IP | 3/min | Spam de contas |

### Estrutura dos nós n8n (por endpoint)
```
[Webhook] → [Code: Extrair IP/user_id] → [Postgres: Rate Limit Check]
         → [IF: request_count > limite?]
               true → [Respond 429: "Muitas tentativas. Aguarde 1 minuto."]
               false → [Fluxo existente continua]
```

### Resposta 429
```json
{
  "sucesso": false,
  "mensagem": "Muitas tentativas. Aguarde 1 minuto e tente novamente.",
  "codigo": "RATE_LIMIT_EXCEEDED"
}
```
Headers obrigatórios: `Access-Control-Allow-Origin: https://giifsystem.com.br`

---

## 8. Convenções e Padrões do Código

### admin.js

```javascript
// Gateway único para todas as ações admin
async function adminGateway(acao, params = {}) {
    const n8nAction = ACTION_MAP[acao] || acao;
    const res = await fetch(`${N8N_BASE_URL}${GATEWAY_ENDPOINT}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',      // CSRF header
            'Authorization': `Bearer ${sessionStorage.getItem('giif_admin_token')}`
        },
        body: JSON.stringify({ acao: n8nAction, admin_id: sessionStorage.getItem('giif_admin_id'), ...params })
    });
}

// XSS prevention — usar sempre para dados externos em innerHTML
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Botões que precisam de contexto usam data-* + handler function (não inline onclick)
function handleEditUserClick(btn) { openEditUserModal(btn.dataset.uid); }
function handleDeleteUserClick(btn) { deleteUser(btn.dataset.uid); }
// HTML: <button onclick="handleEditUserClick(this)" data-uid="${esc(u.id)}">
```

### index.html

```javascript
const N8N_BASE_URL = '/api';              // Proxy Netlify (10s timeout)
const N8N_DIRECT_URL = 'https://giif-api.duckdns.org/webhook'; // Direto (fallback, 180s)

function getToken() { return sessionStorage.getItem('giif_user_token') || ''; }

// Todas as chamadas autenticadas incluem:
headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'Authorization': `Bearer ${getToken()}`
}

// Relatórios usam DOMPurify + marked (sempre nessa ordem)
element.innerHTML = DOMPurify.sanitize(marked.parse(data.relatorio_texto));
```

### n8n Code nodes

```javascript
// JWT — mesmo secret em todos os 7 nós (não pode usar process.env)
const secret = 'bJgnt1ruudNiWMFLyU6DHZkIcwNNNka1RkwWm4QHpys=';

// Padrão de retorno
return { sucesso: true, ...dados };
return { sucesso: false, mensagem: 'Descrição do erro' };

// Queries SQL — SEMPRE usar queryReplacement com $1, $2 (nunca {{ }} na query)
"query": "SELECT * FROM tabela WHERE id = $1",
"options": { "queryReplacement": "={{ $json.body.usuario_id }}" }
```

---

## 9. Bugs Conhecidos — Motor de IA

| Bug | Nó afetado | Descrição | Prioridade |
|---|---|---|---|
| Multi-arquivo acumula linhas | `Aggregate 4b.1 Agrupar Planilha` | Quando usuário envia 2+ arquivos, o agregador acumula linhas de múltiplas iterações do loop | Alta |
| Binary data grande falha | `4c. Extrair Texto Simples` | Usa `$binary.data.data` (falha para arquivos grandes em binaryMode: separate) | Alta |
| DOCX binary igual | `4d. Tratar DOCX1` | Mesmo padrão de acesso binary que pode falhar | Média |
| Sem retry em C1 e C3 | `9. Retornar ao Canvas`, `Retornar Global` | Apenas C2 tem retry automático (MAX_TENTATIVAS = 2) | Média |

---

## 10. Melhorias de Produto Identificadas

### Prioritárias (alto impacto no negócio)

1. **Email de verificação no cadastro** — Contas fantasma distorcem MRR. Implementar via n8n Send Email + token de confirmação.

2. **MFA para painel admin** — Conta admin comprometida = desastre total. TOTP (Google Authenticator) é suficiente.

3. **Audit log de ações admin** — Requisito de compliance. Criar tabela `audit_log` e registrar quem fez o quê.

4. **Cache de análises** — Usuário fecha browser e perde análise paga. Salvar resultado em `relatorios_ia` e carregar automaticamente ao reabrir.

5. **Token JWT 7 dias → 24h + refresh** — Janela de ataque reduzida de 7 dias para 24h.

### Médias (UX/Performance)

6. **Progress bar com contador de segundos** — Análise pode levar 180s; usuário não distingue processando de travado.

7. **Retry automático em C1 e C3** — Padronizar com C2 (já tem MAX_TENTATIVAS = 2).

8. **Drawflow com lazy loading** — Carregado globalmente (~20KB), deveria ser carregado apenas na página do Mapa Estratégico.

9. **marked.js com versão pinada** — Fixar `@9.1.6` para evitar breaking changes automáticos.

10. **Erros HTTP diferenciados** — Hoje 502, 503, 504 retornam mensagem genérica. Diferenciar: "IA sobrecarregada (502)" vs "Timeout (504)".

### Escalabilidade

11. **N+1 em Health Monitor** — Query faz subqueries por usuário dentro de SELECT *; consolidar em JOIN.

12. **Otimização de tokens** — Planilhas grandes enviam centenas de linhas para a IA; implementar smart sampling (top 50 linhas + estatísticas).

13. **Custos de IA com volume** — Camada 2 (Sonnet) e Camada 3 têm custo significativo. Implementar alertas de custo por usuário no billing.

14. **Modularizar index.html** — 4.886 linhas num único arquivo; migrar para Vite + Vue/React para separação de concerns, code splitting e tree shaking.

---

## 11. Configuração de Segurança (Netlify)

### `_headers` atual
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: https:; connect-src 'self' https://giif-api.duckdns.org https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Problema:** `'unsafe-inline'` e `'unsafe-eval'` necessários porque todo JS está inline. Remover exigiria mover ~2.600 linhas de JS para arquivo externo.

---

## 12. Contexto Técnico Importante

### n8n 2.15.0 — Limitações críticas
- `process.env`, `$env`, `$vars` são **todos bloqueados** em Code nodes
- JWT secret **deve ficar hardcoded** nos Code nodes (sem alternativa na versão atual)
- Ao rodar em `binaryMode: separate`, acesso a binários grandes pode falhar com padrão `$binary.data.data`

### Workflow JSON — Como editar
- Os arquivos JSON são exportações do n8n
- Para aplicar: n8n UI → Importar workflow → selecionar arquivo → ativar
- Editar JSON diretamente é arriscado mas viável para mudanças pontuais em `parameters.jsCode` ou `parameters.query`
- Ao editar, usar o node `id` como âncora para garantir que o edit é único

### IDs de nós importantes (Gateway (6).json)
| Nó | ID |
|---|---|
| Validador JWT Admin | `7657d304-8737-4333-a34d-62c0e7abcd0d` |
| DB: Validar Credenciais | `212b7db9-5ced-4b18-8eb9-b73dfaf0f5fc` |
| DB: Validar Login Admin | `91203404-6d03-432a-b282-051964f19aba` |
| Webhook Admin Gateway | `11fddeb2-428b-489b-927c-a906e5d860be` |
| Webhook Gateway Cliente | `d077795b-dbcd-4376-8aff-2ccb1c355427` |
| GIIF - Autenticação | `b0195e47-77c5-4452-9449-92831407f1ec` |

---

## 13. Checklist de Deploy

Antes de importar qualquer arquivo n8n atualizado:

- [ ] Verificar que `giifsystem.com.br` aparece 35x no Gateway (sem placeholders `DOMINIO-NETLIFY`)
- [ ] Verificar que JWT secret é `bJgnt1ruudNiWMFLyU6DHZkIcwNNNka1RkwWm4QHpys=` em todos os 7 nós
- [ ] Validar que `Validador JWT Admin` contém `if (!item.body.usuario_id) item.body.usuario_id = payloadObj.usuario_id`
- [ ] Validar que `DB: Validar Credenciais` usa `UPDATE ... RETURNING` (grava ultimo_acesso)
- [ ] Validar que `DB: Validar Login Admin` usa `UPDATE ... RETURNING` (grava ultimo_acesso)
- [ ] Testar login de usuário → token gerado
- [ ] Testar login admin → token admin gerado, painel carrega
- [ ] Testar editar usuário → altera o usuário correto (não o admin)
- [ ] Testar `ultimo_acesso` → data atualizada após login

Antes de fazer deploy do frontend (Netlify):

- [ ] Verificar que `admin.js` tem `X-Requested-With` no `adminGateway()`
- [ ] Verificar que `index.html` tem `X-Requested-With` em todos os fetch autenticados
- [ ] Verificar que `_headers` tem HSTS e X-Frame-Options
- [ ] Build passes sem erros (Netlify auto-deploy via git push)

---

## 14. Próximos Passos — Por Prioridade

### Sessão imediata (30 min)
1. Aplicar **C-01**: role check no `Validador JWT Admin`
2. Aplicar **C-02**: SQL injection em "DB: Listar Lobby" e "DB: Salvar Vinculo Consultor"
3. Aplicar **C-03**: role check no `adminLogin` (admin.js linha 344)

### Esta semana
4. **A-01**: CORS nos 7 webhooks → `giifsystem.com.br`
5. **A-02**: Rate limiting no `/api-cadastro` (usar SQL da seção 7)
6. **A-03**: XSS em offer preview (admin.js linha 957)
7. **A-05**: Catches vazios (index.html linhas 2410, 3287)
8. **VULN-11**: Implementar rate limiting completo nos 3 endpoints (login, gateway, motor)

### Próxima sprint
9. **A-04**: Motor usar `usuario_id` do JWT, não do body
10. **A-06**: Criar `audit_log` e instrumentar ações destrutivas
11. **M-01**: Timeouts nas 9 chamadas fetch sem AbortController
12. **M-02**: Retry em Camada 1 e Camada 3 do Motor
13. **M-03**: Progress bar com contador de segundos

### Backlog técnico
- VULN-03: Roles do localStorage → sessionStorage
- VULN-04: Remover unsafe-inline (requer modularização do JS)
- Lazy loading Drawflow
- marked.js com versão pinada
- Token JWT 24h + refresh
- MFA para admin
- Email de verificação no cadastro
- Audit log completo
- Smart sampling de planilhas (redução de tokens)

---

*Documento gerado em 2026-06-23. Representa o estado completo do projeto após sessões de desenvolvimento e auditoria de segurança.*
