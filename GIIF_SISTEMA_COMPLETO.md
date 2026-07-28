# GIIF System — Documentação Técnica Completa
> Mapeamento de funcionalidades, banco de dados e organização de dados  
> Gerado em: 2026-07-28 | Versão do workflow analisado: v9 (Corrigido) | Schema verificado via `docker exec giif_postgres`

---

## 1. Visão Geral

**GIIF System** é uma plataforma SaaS B2B de análise empresarial orientada por IA consultiva. Funciona como um "Sócio-Diretor de IA" que analisa dados empresariais em múltiplas camadas e entrega diagnósticos executivos personalizados.

**Produção:** `https://giifsystem.com.br` (Netlify CDN)  
**API Backend:** `https://giif-api.duckdns.org` (n8n self-hosted v2.15.0)  
**Proxy:** Netlify Functions em `/api/*` → n8n (timeout 10s); IA direto ao n8n (timeout 300s)

---

## 2. Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend usuário | HTML5 + TailwindCSS (CDN) + Vanilla JS + Chart.js + Marked.js + DOMPurify + html2pdf + Drawflow v0.0.60 |
| Frontend admin | HTML5 + CSS customizado + Vanilla JS + Chart.js + SweetAlert2 |
| Orquestrador IA | n8n v2.15.0 (self-hosted) |
| IA — Camada 1 | Anthropic Claude Haiku 4.5 (normalização de dados) |
| IA — Camadas 2/3 | Anthropic Claude Sonnet 4.6 (análise aprofundada + global + PDF) |
| Banco de dados | PostgreSQL 14 (Docker `giif_postgres` na VM, user `n8n`) |
| Hospedagem | Netlify (auto-deploy via push para `main` do repo `MarcosGabx/giif-system`) |
| Auth | JWT HS256 implementado em Code nodes n8n (`crypto.createHmac`) |

---

## 3. Organização de Arquivos

```
giif_system-main/
├── for_deploy/                  ← ÚNICA PASTA PUBLICADA (Netlify)
│   ├── index.html               # SPA do usuário (~6.300 linhas)
│   ├── admin.html               # Painel administrativo
│   ├── css/
│   │   └── admin.css
│   ├── js/
│   │   └── admin.js             # Lógica admin (~1.600 linhas)
│   ├── _headers                 # CSP, HSTS, X-Frame-Options
│   └── _redirects               # Proxy /api/* → giif-api.duckdns.org
├── netlify.toml                 # publish = "for_deploy" — NUNCA alterar
├── docs/
│   └── create_logs_atividade.sql
├── PROJECT_SCOPE.md
└── GIIF_SISTEMA_COMPLETO.md     # Este arquivo
```

> **REGRA DE DEPLOY:** Toda alteração para produção vai em `for_deploy/`. Arquivos na raiz do repo estão no `.gitignore` e nunca são publicados.

---

## 4. Autenticação e Sessão

### Fluxo de Login (Usuário/Consultor)

```
POST /api-login  { email, senha }
  → n8n: UPDATE usuarios_giif SET ultimo_acesso=NOW()
         WHERE email=$1 AND senha_hash=$2
         RETURNING id, nome_completo, email, nome_empresa, segmento, plano, role, is_parceiro
  ← { token: JWT, id, nome_completo, email, nome_empresa, segmento, plano, role, is_parceiro }

Frontend armazena:
  sessionStorage: giif_user_token (JWT — expira em 7 dias)
  localStorage:   giif_user_id, giif_user_role, giif_user_plano,
                  giif_user_nome, giif_user_empresa, giif_user_segmento,
                  giif_user_is_parceiro
```

### Fluxo de Login (Admin)

```
POST /api-admin-gateway  { acao: 'login', email, senha }
  → n8n: UPDATE usuarios_giif SET ultimo_acesso=NOW()
         WHERE email=$1 AND senha_hash=$2 AND role='admin'
  ← { token: JWT, id, nome, role }

Frontend armazena:
  sessionStorage: giif_admin_token, giif_admin_id, giif_admin_nome
```

### JWT

- Algoritmo: HS256 (HMAC-SHA256 via `crypto.createHmac`)
- Secret hardcoded em todos os 7 nós validadores n8n (limitação n8n 2.15.0 — `process.env` bloqueado)
- Payload: `{ usuario_id, exp }` (TTL 7 dias)
- O validador (`Validador JWT Cliente`) sobrescreve `body.usuario_id` com o UUID do JWT para prevenir spoofing

### Variáveis de Sessão do Frontend

| Variável | Tipo | Fonte | Uso |
|---|---|---|---|
| `_sessaoRole` | runtime | JWT validator + `validar_sessao` | Controla acesso a funcionalidades |
| `_sessaoPlano` | runtime | JWT validator + `validar_sessao` | Limites de mapas e módulos |
| `_sessaoIsParceiro` | runtime | JWT validator + `validar_sessao` | UI de parceiro |
| `giif_user_id` | localStorage | Login response | Enviado em todas as requests autenticadas |

> **Nota consultor:** Quando o consultor seleciona uma empresa no Lobby, `_sessaoPlano` é trocado para o plano do CLIENTE. A variável `_sessaoRole` permanece `'consultor'`. Toda verificação de limite de mapa usa `_sessaoRole === 'consultor'` como bypass.

---

## 5. Organização do Banco de Dados

### 5.1 `usuarios_giif` — Tabela principal de usuários

| Coluna | Tipo real (verificado) | Notas |
|---|---|---|
| `id` | `uuid` NOT NULL DEFAULT `gen_random_uuid()` | PK — UUID nativo |
| `nome_completo` | `varchar` NULL | Nome completo |
| `email` | `varchar` NULL (UNIQUE implícito) | Email de login |
| `senha_hash` | `text` NULL | Senha em texto simples (sem hash real — BUG pendente) |
| `nome_empresa` | `varchar` NULL | Empresa do usuário |
| `segmento` | `varchar` NULL | Segmento de mercado |
| `plano` | `varchar` NULL | Ver tabela de planos abaixo |
| `status` | `varchar` NULL | `'ativo'` / `'inativo'` |
| `role` | `varchar` NULL DEFAULT `'admin'` | `'usuario'` / `'consultor'` / `'admin'` |
| `is_parceiro` | `boolean` NULL DEFAULT `false` | Flag de parceiro/revendedor |
| `criado_em` | `timestamp` NULL DEFAULT `CURRENT_TIMESTAMP` | Auto-preenchido |
| `ultimo_acesso` | `timestamp` NULL | Atualizado a cada login — **coluna já existe** |

> **Nota de tipo:** `id` é UUID nativo. Em queries que comparam com colunas TEXT de outras tabelas, usar `id::text`. Em parâmetros `$N` de queryReplacement, PostgreSQL infere e faz o cast automaticamente.

**Planos e limites de mapas:**

| Valor em `plano` | Descrição | Mapas | MRR (R$) |
|---|---|---|---|
| `'essencial_estrategico'` | Essencial – módulo Estratégico | 3 | 197 |
| `'essencial_financeiro'` | Essencial – módulo Financeiro | 3 | 197 |
| `'essencial_comercial'` | Essencial – módulo Comercial | 3 | 197 |
| `'essencial_marketing'` | Essencial – módulo Marketing | 3 | 197 |
| `'essencial_pessoas'` | Essencial – módulo Pessoas | 3 | 197 |
| `'profissional'` | Todos os 5 módulos | 4 | 397 |
| `'parceiro'` | Parceiro/revendedor | Ilimitado | 0 |
| `'enterprise'` | Enterprise | Ilimitado | a definir |
| `'premium'` | Premium | Ilimitado | a definir |
| `'estrategico'` | Estratégico | Ilimitado | a definir |

---

### 5.2 `relatorios_ia` — Relatórios de diagnóstico

| Coluna | Tipo real (verificado) | Notas |
|---|---|---|
| `id` | `uuid` NOT NULL DEFAULT `gen_random_uuid()` | PK |
| `usuario_id` | `uuid` NULL | FK → `usuarios_giif.id` |
| `modulo` | `varchar` NOT NULL | `'estrategico'` / `'financeiro'` / `'comercial'` / `'marketing'` / `'pessoas'` / `'geral'` |
| `data_geracao` | `timestamp` NULL DEFAULT `now()` | Quando o relatório foi gerado |
| `scores` | `jsonb` NULL | Ex: `{ "nota_estrategico": 72, "nota_geral": 68 }` |
| `relatorio_texto` | `text` NULL | Markdown gerado pela IA (pode ser grande) |
| `dados_entrada` | `text` NULL | Dados brutos do formulário de entrada |
| `dados_normalizados` | `jsonb` NULL | Saída estruturada da normalização C1 (Haiku) |
| `indicadores` | `jsonb` NULL | Indicadores extraídos pela IA |
| `qualidade_dados` | `jsonb` NULL | Score de qualidade dos dados de entrada |
| `resumo_estruturado` | `jsonb` NULL | Resumo em formato estruturado |
| `ia_json_valido` | `boolean` NULL DEFAULT `true` | Flag de validade do JSON retornado pela IA |
| `versao_prompt` | `text` NULL | Versão do prompt usado |
| `modelo` | `text` NULL | Modelo de IA usado (ex: `claude-haiku-4-5`) |
| `tipo_analise` | `text` NULL | `'inicial'` / `'aprofundada'` / `'global'` |
| `camada` | `text` NULL | `'C1'` / `'C2'` / `'C3'` |

Custo por diagnóstico: **R$ 0,70** (usado no billing admin).

---

### 5.3 `mapas_projetos` — Mapas estratégicos (multi-mapa)

| Coluna | Tipo real (verificado) | Notas |
|---|---|---|
| `id` | `varchar` NOT NULL DEFAULT `gen_random_uuid()::text` | PK — string no formato UUID |
| `usuario_id` | `uuid` NULL | FK → `usuarios_giif.id` — UUID nativo |
| `nome_mapa` | `varchar` NOT NULL | Nome exibido na aba |
| `mapa_json` | `jsonb` NULL | Estrutura Drawflow completa |
| `data_criacao` | `timestamp` NULL DEFAULT `CURRENT_TIMESTAMP` | Auto-preenchido |
| `data_atualizacao` | `timestamp` NULL DEFAULT `CURRENT_TIMESTAMP` | Atualizado no UPSERT |

> **Atenção de tipo:** `usuario_id` é UUID nativo. Os parâmetros `$N` no queryReplacement enviam strings; PostgreSQL faz o cast automaticamente para UUID quando o destino é uma coluna UUID. Funciona para IDs no formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

> **⚠ MIGRAÇÃO URGENTE:** A tabela `mapas_estrategicos` (legada, single-map) contém **57 linhas** de dados reais de usuários que não aparecem no sistema atual. Ver seção 15.3.

---

### 5.4 `consultor_clientes` — Vínculo consultor ↔ empresa

| Coluna | Tipo real (verificado) | Notas |
|---|---|---|
| `id` | `text` NOT NULL DEFAULT `gen_random_uuid()::text` | PK |
| `consultor_id` | `text` NULL | UUID do consultor armazenado como TEXT |
| `usuario_id` | `text` NULL | UUID da empresa/cliente armazenado como TEXT |
| `criado_em` | `timestamp` NULL DEFAULT `CURRENT_TIMESTAMP` | Auto-preenchido |

> **Atenção de tipos (verificado):** `consultor_id` e `usuario_id` são TEXT, não UUID nativo. `usuarios_giif.id` é UUID nativo. O cast correto para joins é **`u.id::text = cc.consultor_id`** (cast UUID→TEXT), não o contrário.

**Restrição:** `ON CONFLICT DO NOTHING` no INSERT previne duplicatas.

---

### 5.5 `tickets_suporte` — Chamados de suporte

| Coluna | Tipo real (verificado) | Notas |
|---|---|---|
| `id` | `uuid` NOT NULL DEFAULT `gen_random_uuid()` | PK |
| `usuario_id` | `uuid` NULL | FK → `usuarios_giif.id` — UUID nativo |
| `assunto` | `varchar` NOT NULL | Título do chamado |
| `categoria` | `varchar` NOT NULL | Categoria selecionada pelo usuário |
| `mensagem` | `text` NOT NULL | Corpo do chamado |
| `status` | `varchar` NULL DEFAULT `'Aberto'` | `'Aberto'` / `'Respondido'` / `'Encerrado'` |
| `resposta_admin` | `text` NULL | Resposta do administrador |
| `data_criacao` | `timestamp` NULL DEFAULT `CURRENT_TIMESTAMP` | Auto-preenchido |
| `data_atualizacao` | `timestamp` NULL | Atualizado na resposta |

---

### 5.6 `logs_atividade` — Auditoria de ações

| Coluna | Tipo real (verificado) | Notas |
|---|---|---|
| `id` | `integer` NOT NULL (serial) | PK autoincrement |
| `ator_id` | `text` NULL | ID de quem executou a ação |
| `ator_nome` | `text` NULL | Nome legível |
| `ator_papel` | `text` NULL | `'admin'` / `'usuario'` / `'consultor'` |
| `tipo_evento` | `text` NOT NULL | Ver lista abaixo |
| `modulo` | `text` NULL | Módulo afetado (opcional) |
| `alvo_tipo` | `text` NULL | Tipo do objeto afetado (opcional) |
| `alvo_id` | `text` NULL | ID do objeto afetado (opcional) |
| `alvo_nome` | `text` NULL | Nome legível do objeto afetado (opcional) |
| `metadados` | `jsonb` NULL | Dados extras (ex: plano anterior/novo) |
| `criado_em` | `timestamp` NULL DEFAULT `now()` | Auto-preenchido |

**Eventos auditados:**

| `tipo_evento` | Quando disparado |
|---|---|
| `'login'` | Login de usuário/consultor |
| `'login_admin'` | Login de admin |
| `'usuario_criado'` | Admin cria usuário |
| `'usuario_editado'` | Admin edita dados de usuário |
| `'usuario_excluido'` | Admin exclui usuário |
| `'senha_resetada'` | Admin reseta senha |

> **Tabela já existe** — `docs/create_logs_atividade.sql` já foi executado.  
> **`ultimo_acesso` já existe** em `usuarios_giif` — ALTER TABLE não é necessário.

---

### 5.7 Relacionamentos entre tabelas (tipos verificados)

```
usuarios_giif (id UUID)
  ├── relatorios_ia.usuario_id UUID     → direto (UUID = UUID)
  ├── mapas_projetos.usuario_id UUID    → direto (UUID = UUID); $N via n8n: cast implícito
  ├── tickets_suporte.usuario_id UUID   → direto (UUID = UUID); $N via n8n: cast implícito
  ├── logs_atividade.ator_id TEXT       → cast necessário: u.id::text = la.ator_id
  └── consultor_clientes
        ├── consultor_id TEXT → cast: u.id::text = cc.consultor_id  ✓
        └── usuario_id   TEXT → cast: u.id::text = cc.usuario_id    ✓
```

**Regra geral de cast em queries n8n:**
- Column-to-column: sempre `u.id::text = cc.texto_col` (cast UUID → TEXT)
- Parâmetros `$N`: PostgreSQL faz cast implícito baseado no tipo da coluna destino (funciona para UUIDs válidos)

---

## 6. API — Endpoints n8n

### 6.1 `/api-login` (Webhook Cadastro/Autenticação)

| Ação | Método | Autenticação | Payload |
|---|---|---|---|
| Login usuário/consultor | POST | Nenhuma | `{ email, senha }` |
| Cadastro | POST /api-cadastro | Nenhuma | `{ nome, empresa, email, senha }` |

---

### 6.2 `/api-gateway` (Gateway Cliente — JWT obrigatório)

Todas as chamadas: `{ acao, usuario_id, ...campos_específicos }`  
O `usuario_id` é sobrescrito pelo validador JWT com o UUID do token.

| `acao` | Nó n8n | Descrição |
|---|---|---|
| `validar_sessao` | DB: Validar Sessão | Retorna dados frescos do usuário (role, plano, nome, empresa, segmento) |
| `salvar_mapa` | DB: Salvar Multi-Mapa | UPSERT em `mapas_projetos`; auto-save debounce 3s |
| `carregar_mapas` | DB: Carregar Mapas (Array) | Lista todos os mapas do usuário (ASC por data_criacao) |
| `excluir_mapa` | DB: Excluir Mapa | DELETE em `mapas_projetos` WHERE id=$1 |
| `listar_responsaveis_mapa` | DB: Listar Responsaveis Mapa | Lista consultores vinculados ao usuário |
| `listar_lobby_consultor` | DB: Listar Lobby Consultor | Lista empresas vinculadas ao consultor |
| `desvincular_consultor_empresa` | DB: Desvincular Empresa | Remove vínculo consultor ↔ empresa |
| `abrir_ticket` | DB: Abrir Ticket | INSERT em `tickets_suporte` |
| `listar_tickets_cliente` | DB: Listar Tickets Cliente | Tickets do usuário autenticado |

---

### 6.3 `/api-admin-gateway` (Admin Gateway — JWT admin obrigatório)

| `acao` | Nó n8n | Descrição |
|---|---|---|
| `login` | DB: Validar Login Admin | Login admin (role='admin' obrigatório) |
| `listar_usuarios` | DB: Buscar Usuários | Todos os usuários + contagem de diagnósticos |
| `criar_usuario` | DB: Criar Usuário Admin | INSERT + LOG |
| `editar_usuario` | DB: Atualizar Usuário | UPDATE + LOG |
| `excluir_usuario` | DB: Excluir Usuário | DELETE + LOG |
| `resetar_senha` | DB: Resetar Senha | UPDATE senha_hash + LOG |
| `dashboard_completo` | DB: Dashboard Completo | Contagens por plano + MRR + total diagnósticos |
| `listar_health_bruto` | DB: Listar Health Bruto | Dados de saúde por empresa (histórico de scores) |
| `listar_billing_dinamico` | DB: Listar Billing Dinâmico | MRR + custo de diagnósticos por usuário |
| `listar_consultores` | DB: Listar Consultores | Consultores + empresas vinculadas |
| `criar_consultor` | DB: Criar Usuário Consultor1 | INSERT com role='consultor' |
| `atribuir_consultor` | DB: Atribuir Consultor | INSERT em `consultor_clientes` |
| `listar_tickets_admin` | DB: Listar Tickets Admin | Todos os tickets (com joins) |
| `responder_ticket` | DB: Responder Ticket | UPDATE status + resposta |
| `listar_logs_atividade` | DB: Listar Logs Atividade | Últimos N logs (paginado por limit/offset) |

---

### 6.4 Endpoints de IA (Webhook Documentos / Motor 3 Camadas)

Todas as chamadas de IA usam `fetchIA()` com timeout de 300s (5 min) e `X-Requested-With: XMLHttpRequest`.

| Endpoint | Camada | Modelo IA | Descrição |
|---|---|---|---|
| `/api-analisar-estrategico` | C1 — Inicial | Haiku 4.5 | Análise inicial módulo estratégico |
| `/api-analisar-financeiro` | C1 — Inicial | Haiku 4.5 | Análise inicial módulo financeiro |
| `/api-analisar-comercial` | C1 — Inicial | Haiku 4.5 | Análise inicial módulo comercial |
| `/api-analisar-marketing` | C1 — Inicial | Haiku 4.5 | Análise inicial módulo marketing |
| `/api-analisar-pessoas` | C1 — Inicial | Haiku 4.5 | Análise inicial módulo pessoas |
| `/api-analise-aprofundada` | C2 — Aprofundada | Sonnet 4.6 | Análise aprofundada do módulo selecionado |
| `/api-analise-global` | C3 — Global | Sonnet 4.6 | Análise integrada de todos os módulos |
| `/api-documentos` | — | Sonnet 4.6 | Geração de PDF executivo |
| `/api-atualizar-perfil` | — | — | Atualização de perfil (nome empresa, segmento, senha) |

---

## 7. Módulos de Análise (IA)

### 7.1 Cinco Módulos Analíticos

| Módulo | `modulo` no banco | Campos de entrada | Score gerado |
|---|---|---|---|
| Estratégico | `'estrategico'` | Posicionamento, diferencial, maturidade, nicho, ciclo | `nota_estrategico` |
| Financeiro | `'financeiro'` | Faturamento, lucro, dívidas, custos, sazonalidade | `nota_financeiro` |
| Comercial | `'comercial'` | Ticket médio, conversão, funil, canais, objeções | `nota_comercial` |
| Marketing | `'marketing'` | Redes, tráfego, persona, posicionamento digital | `nota_marketing` |
| Pessoas | `'pessoas'` | Equipe, cultura, retenção, capacitação | `nota_pessoas` |

### 7.2 Camadas de Análise

```
C1 — Análise Inicial
  - Haiku 4.5 normaliza os dados brutos do formulário
  - Gera relatório executivo em Markdown
  - Salva em relatorios_ia com scores
  - Disponível para todos os planos (com restrição de módulo no Essencial)

C2 — Análise Aprofundada
  - Sonnet 4.6 aprofunda um módulo específico
  - Requer C1 do módulo já realizado
  - Disponível a partir do plano Profissional

C3 — Análise Global
  - Sonnet 4.6 integra todos os módulos
  - Gera visão holística da empresa
  - Requer todos os 5 módulos C1 realizados
  - Plano Profissional ou superior

PDF Executivo
  - Sonnet 4.6 + html2pdf.js
  - Gerado a partir dos relatórios existentes
  - Estilo executivo para apresentação
```

### 7.3 Restrições por Plano

| Plano | Módulos C1 | C2 | C3 | PDF | Mapas |
|---|---|---|---|---|---|
| Essencial (qualquer) | 1 módulo escolhido | ✗ | ✗ | ✗ | 3 |
| Profissional | Todos os 5 | ✓ | ✓ | ✓ | 4 |
| Enterprise/Premium/Estratégico | Todos os 5 | ✓ | ✓ | ✓ | ∞ |
| Parceiro (consultor) | Todos os 5 | ✓ | ✓ | ✓ | ∞ |

---

## 8. Mapa Estratégico (Drawflow)

### 8.1 Sistema Multi-Mapa

- Engine: Drawflow v0.0.60 (biblioteca de nós conectáveis)
- Múltiplos mapas por usuário, cada um numa aba
- IDs gerados no frontend: `mapa_${Date.now()}_${Math.random().toString(36).substr(2,6)}`
- Auto-save debounce: 3 segundos após última modificação
- UPSERT no backend (`ON CONFLICT (id) DO UPDATE`)

### 8.2 Tipos de Nós (Cores)

| Cor | Classe CSS | Uso típico |
|---|---|---|
| Verde | `node-color-green` | Estratégia, resultado positivo |
| Vermelho | `node-color-red` | Risco, problema |
| Âmbar | `node-color-amber` | Atenção, alerta |
| Azul | `node-color-blue` | Processo, ação |
| Violeta | `node-color-violet` | Inovação, projeto |
| Slate | `node-color-slate` | Neutro, contexto |

### 8.3 Funcionalidades

- Criar, renomear, excluir mapas (via abas)
- Pan/zoom via Pointer Events API (fix necessário para reconhecer clique na 1ª tentativa)
- Links entre nós (setas conectoras)
- Painel de detalhes por nó (clique no nó → painel lateral)
- Tarefas (checklist) por nó
- Responsável do nó (consultor vinculado)
- Exportar mapa como JSON

### 8.4 Tarefas (Task Manager)

Cada nó pode ter tarefas. Estrutura armazenada no `mapa_json`:
- Título, texto, data de vencimento, data de início
- Status: checklist de sub-tarefas
- Responsável: ID de usuário/consultor

---

## 9. Funcionalidades do Painel Admin

Arquivo: `for_deploy/admin.html` + `for_deploy/js/admin.js`

### 9.1 Seções

| Seção | Funcionalidade |
|---|---|
| Dashboard | MRR, total de usuários por plano, total de diagnósticos, gráficos Chart.js |
| Usuários | Listagem, busca, criar, editar, excluir, resetar senha |
| Billing | Custo por diagnóstico (R$0,70/diagnóstico), MRR por plano, tabela por usuário |
| Health Monitor | Score de saúde por empresa (últimos 10 relatórios), gráfico histórico |
| Consultores | Listar, criar, vincular a empresas |
| Tickets | Listar, filtrar por status, responder |
| Logs de Atividade | Auditoria de ações administrativas (últimos 100, paginado) |

### 9.2 Payloads Admin Importantes

```javascript
// Criar usuário — campos obrigatórios
{ acao: 'criar_usuario', nome, email, senha, empresa, segmento, plano, role }

// Editar usuário
{ acao: 'editar_usuario', target_user_id, nome, empresa, segmento, plano, status, role }

// Resetar senha
{ acao: 'resetar_senha', target_user_id, nova_senha }

// Atribuir consultor
{ acao: 'atribuir_consultor', consultor_id, usuario_id }

// Listar logs
{ acao: 'listar_logs_atividade', admin_id, admin_nome, limit: 100, offset: 0 }
```

---

## 10. Fluxo Consultor

```
1. Consultor faz login → role = 'consultor'
2. Frontend detecta role e exibe aba "Lobby"
3. GET listar_lobby_consultor → lista empresas vinculadas
4. Consultor clica em uma empresa → selecionarEmpresaLobby(empresaId)
   - _sessaoPlano = plano do CLIENTE (não do consultor)
   - _sessaoRole PERMANECE 'consultor'
5. Frontend mostra dados do cliente selecionado
6. Consultor usa funcionalidades em nome do cliente

Limites de mapa:
  - getMapaLimitePorPlano() sempre retorna Infinity se _sessaoRole === 'consultor'
  - Consultor nunca é bloqueado pelo limite de mapas, independente do plano do cliente

Desvincular empresa:
  POST /api-gateway { acao: 'desvincular_consultor_empresa', empresa_id }
  JWT valida e define usuario_id = consultor UUID
  DELETE consultor_clientes WHERE consultor_id=$1 AND usuario_id=$2
```

---

## 11. Organização do Fluxo de Dados

### 11.1 Fluxo de Criação de Diagnóstico

```
Usuário preenche formulário
  → escolher módulo → selecionar campos → inserir dados

Frontend → POST /api-analisar-{modulo} (timeout 300s)
  → n8n Webhook Documentos
  → Validador JWT
  → Motor 3 Camadas (workflow separado)
    → C1: Haiku 4.5 normaliza + analisa
    → Postgres: INSERT relatorios_ia (usuario_id, modulo, scores, relatorio_texto)
  ← Markdown do relatório

Frontend renderiza via Marked.js + DOMPurify
Frontend atualiza histórico (relatorios_ia via /api-documentos)
```

### 11.2 Fluxo de Auto-Save do Mapa

```
Usuário modifica nó/conexão
  → Evento Drawflow (node:created / node:removed / connection*)
  → _scheduleAutoSave() → clearTimeout + setTimeout 3s

Após 3s de inatividade:
  → mapaEditor.export() → mapa_json (JSON Drawflow)
  → POST /api-gateway { acao: 'salvar_mapa', mapa_id, usuario_id, nome_mapa, mapa_json }
  → n8n: INSERT mapas_projetos ON CONFLICT (id) DO UPDATE
  ← { sucesso: true, mapa_id, nome_mapa }
```

### 11.3 Fluxo de Exclusão de Mapa (Corrigido)

```
Usuário clica X na aba → excluirMapa(mapaId)
  → SweetAlert confirmação
  → POST /api-gateway { acao: 'excluir_mapa', mapa_id }
  → n8n: DELETE mapas_projetos WHERE id=$1 RETURNING id
  ← { sucesso: true } ou erro

Frontend:
  → mapasUsuario = filter(≠ mapaId)
  → mapaAtualId = null  ← CRÍTICO: anula antes de trocarMapa
  → trocarMapa(mapasUsuario[0].mapa_id)
    → fire-and-forget NÃO dispara (mapaAtualId === null)
    → carrega primeiro mapa disponível
```

---

## 12. Design System

### 12.1 Temas (Dark/Light)

O tema é controlado por `html.dark` (classe no elemento raiz) e `localStorage.giif_theme`.

**Paleta Dark Mode — CORRETO:**
- Background principal: `#0f0f0f` / `#1c1c1e`
- Cards/superfícies: `rgba(28, 28, 30, 0.9)` / `rgba(30, 30, 30, *)`
- Bordas: `rgba(255, 255, 255, 0.08)` / `rgba(255, 255, 255, 0.10)`
- Scrollbar thumb: `#2e2e2e`

**Paleta que NÃO deve aparecer em dark mode:**
- `rgba(15, 23, 42, *)` — blue-slate (cor light mode)
- `rgba(17, 24, 39, *)` — blue-slate variante
- `#1e293b` — slate-800 (cor light mode)

### 12.2 Variáveis de Cor do Sistema

```css
--brand-primary: #3B55E6   /* Azul marca */
--brand-accent:  #7B2DFE   /* Violeta acento */
--score-alto:    #10b981   /* Verde — score bom */
--score-medio:   #f59e0b   /* Âmbar — score médio */
--score-baixo:   #ef4444   /* Vermelho — score baixo */
```

---

## 13. Limitações Técnicas Conhecidas

| Limitação | Impacto | Workaround |
|---|---|---|
| n8n 2.15.0: `process.env`/`$env`/`$vars` bloqueados em Code nodes | JWT secret não pode ser externalizado | Secret hardcoded nos nós |
| `queryReplacement` strips parâmetros vazios | `$N` desalinhado quando parâmetros opcionais | Usar apenas parâmetros sempre presentes |
| Tipos mistos UUID/TEXT entre tabelas | `operator does not exist: uuid = text` em joins column-to-column | Cast correto: `u.id::text = cc.texto_col` (UUID→TEXT); parâmetros `$N` são imunes (PostgreSQL faz cast implícito) |
| `usuarios_giif.id` UUID; `consultor_clientes.*_id` TEXT (verificado) | Join sem cast falha | **Regra:** sempre `u.id::text = cc.consultor_id` |
| `DB: Listar Responsaveis Mapa`: cast errado `u.id = cc.consultor_id::text` (v8) | UUID = TEXT → erro ao listar responsáveis | **Corrigido no v9:** `u.id::text = cc.consultor_id` |
| Drawflow: primeiro clique não reconhece pan | Usuário precisa clicar 2x para iniciar pan | Corrigido via Pointer Events API + `setPointerCapture` |
| `DB: Listar Health Bruto`: `role = 'user'` (v8) | Retorna 0 registros no Health Monitor | **Corrigido no v9:** `role = 'usuario'` |
| `DB: Excluir Mapa`: `AND usuario_id = $2` (v8) | Mapa deletado por consultor volta no reload | **Corrigido no v9:** removido `AND usuario_id = $2` |
| Webhook `/api-gateway`: 3 rotas ausentes (v8) | `validar_sessao`, `listar_lobby_consultor`, `desvincular_consultor_empresa` sem resposta | **Corrigido no v9:** rotas + nós criados |
| `mapas_estrategicos` com 57 linhas legadas | Mapas de usuários antigos invisíveis no sistema atual | **⚠ Migração manual necessária** — ver seção 15.3 |

---

## 14. Workflow n8n — Estrutura

### 14.1 Webhooks (7 entradas)

| Webhook | Path | Uso |
|---|---|---|
| GIIF - Autenticação | `/api-login` | Login de usuários e consultores |
| Webhook Cadastro | `/api-cadastro` | Auto-cadastro de novos usuários |
| Webhook Gateway Cliente | `/api-gateway` | Todas as operações autenticadas de usuário |
| Webhook Admin Gateway | `/api-admin-gateway` | Operações administrativas |
| Webhook (Atualizar) | `/api-atualizar-perfil` | Atualização de perfil |
| Webhook Documentos 1 | `/api-documentos` | Busca relatórios existentes |
| Webhook Documentos 2 | `/api-documentos` (variante) | Busca sem texto completo |

### 14.2 Nós de Validação JWT (5 validadores + 2 geradores)

- `Validador JWT Cliente` → valida token, sobrescreve `body.usuario_id`
- `Validador JWT Admin` → valida token admin
- `Validador JWT Perfil` → valida para atualização de perfil
- `Validador JWT Doc 1/2` → valida para busca de relatórios
- Geradores JWT: no login de usuário e admin

### 14.3 Nós Órfãos Removidos (v9)

- `DB: Salvar Mapa` — usava `mapas_estrategicos` (descontinuado)
- `DB: Carregar Mapa` — usava `mapas_estrategicos` (descontinuado)
- `Execute a SQL query` — continha credenciais admin em texto claro
- `Retornar Sucesso (Criar Consultor)` — nó de retorno desconectado

---

## 15. Deploy e Operação

### 15.1 Checklist de Deploy

```
[ ] Fazer alterações SOMENTE em for_deploy/
[ ] git add for_deploy/...
[ ] git commit + git push → Netlify faz deploy automático
[ ] Verificar deploy em https://giifsystem.com.br
[ ] Hard refresh no browser após deploy (Ctrl+Shift+R)
```

### 15.2 Importar Workflow Corrigido (n8n)

```
1. Abrir n8n → Menu → Import Workflow
2. Selecionar: GIIF - Gateway Master Update (Corrigido) v9_FINAL.json
3. Verificar credenciais Postgres (ID: NRLf62TsIz7uXBIh)
4. Ativar workflow
5. Desativar versão anterior
```

**Arquivo:** `GIIF - Gateway Master Update (Corrigido) v9_FINAL.json` (em Downloads)

### 15.3 ⚠ Migração Urgente — `mapas_estrategicos` → `mapas_projetos`

**Situação verificada:** `mapas_estrategicos` tem **57 linhas** de mapas de usuários que existem no sistema antigo (single-map) mas são **invisíveis** no sistema atual (multi-map). Esses usuários entram e não veem nenhum mapa.

**`mapas_estrategicos` schema verificado:**
- `usuario_id` UUID NOT NULL (sem PK declarada além disso — constraint UNIQUE implícita no ON CONFLICT)
- `mapa_json` jsonb NOT NULL
- `atualizado_em` timestamp NULL DEFAULT now()

**Script de migração — rodar via `docker exec -it giif_postgres psql -U n8n`:**

```sql
-- Pré-verificação
SELECT COUNT(*) FROM mapas_estrategicos;         -- deve ser 57
SELECT COUNT(*) FROM mapas_projetos;             -- quantos já existem

-- Migração: cada usuário legado ganha um mapa "Mapa Principal" no novo sistema
INSERT INTO mapas_projetos (id, usuario_id, nome_mapa, mapa_json, data_criacao, data_atualizacao)
SELECT
  gen_random_uuid()::text,                       -- novo id varchar
  usuario_id,                                    -- UUID nativo (compatível com mapas_projetos.usuario_id UUID)
  'Mapa Principal',
  mapa_json,
  COALESCE(atualizado_em, NOW()),
  NOW()
FROM mapas_estrategicos me
WHERE NOT EXISTS (
  SELECT 1 FROM mapas_projetos mp WHERE mp.usuario_id = me.usuario_id
);
-- WHERE NOT EXISTS garante não criar duplicata para usuários que JÁ têm mapa no novo sistema

-- Pós-verificação
SELECT COUNT(*) FROM mapas_projetos;             -- deve aumentar em até 57
```

**Ações já concluídas (não precisam ser rodadas):**
- ~~`ALTER TABLE usuarios_giif ADD COLUMN IF NOT EXISTS ultimo_acesso TIMESTAMP`~~ — coluna já existe
- ~~`docs/create_logs_atividade.sql`~~ — tabela já existe

---

## 16. Segurança

| Item | Status | Notas |
|---|---|---|
| JWT validado no backend | ✓ | HMAC-SHA256, todos os endpoints protegidos |
| CORS headers | Parcial | Response nodes têm `*`; corrigido em `Retorno: Responsaveis Mapa` para `giifsystem.com.br` |
| `body.usuario_id` sobrescrito pelo JWT | ✓ | Previne privilege escalation |
| Senhas | ⚠ | Armazenadas em texto simples em `senha_hash` — não há hash real |
| Credenciais admin no workflow | ✓ Corrigido | Nó `Execute a SQL query` removido no v9 |
| Log de senha em produção | ✓ Corrigido | `console.log DEBUG-TEMP` removido do admin.js |
| CSP | ✓ | Configurado em `for_deploy/_headers` |
| `X-Frame-Options: DENY` | ✓ | Configurado em `for_deploy/_headers` |

> **Pendente crítico:** Implementar hash real de senhas (bcrypt ou Argon2). Atualmente `senha_hash` armazena a senha em texto simples.

---

*Documento gerado em 2026-07-28 a partir da análise do código-fonte (`for_deploy/index.html`, `for_deploy/js/admin.js`) e do workflow n8n v8/v9.*
