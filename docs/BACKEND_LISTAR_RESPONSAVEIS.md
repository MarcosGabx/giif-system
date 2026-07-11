# Backend: ação `listar_responsaveis_mapa`

Arquivo a editar: `C:\Users\marco\Downloads\GIIF - Gateway Master Update (Corrigido) (6).json`

---

## O que fazer

Adicionar um novo ramo ao Switch do Gateway para a ação `listar_responsaveis_mapa`.

O fluxo completo é:

```
Webhook /api-gateway
  → Validador JWT Cliente   (já sobreescreve body.usuario_id — IDOR já protegido)
  → Switch (acao)
      → [novo ramo] listar_responsaveis_mapa
          → Postgres: SELECT consultores vinculados
          → If: tem resultados?
              → Sim → respondToWebhook com array
              → Não → respondToWebhook com []
```

---

## Switch node — adicionar nova regra

No nó Switch que roteia por `{{ $json.body.acao }}`, adicione uma nova saída:

**Valor:** `listar_responsaveis_mapa`

---

## Nó Postgres

**Tipo:** `n8n-nodes-base.postgres`  
**Operação:** `executeQuery`  
**Credenciais:** copiar das credenciais já usadas no fluxo `carregar_mapas`

**Query:**
```sql
SELECT u.id, u.nome_completo
FROM consultor_clientes cc
JOIN usuarios_giif u ON u.id = cc.consultor_id
WHERE cc.usuario_id = $1
ORDER BY u.nome_completo ASC
```

**queryReplacement:** `={{ $json.body.usuario_id }}`

> NUNCA usar `{{ $json.body.usuario_id }}` dentro da query SQL diretamente.
> Sempre usar `$1` na query + `queryReplacement`.

---

## Nó If (verificar resultado)

**Condição:** `{{ $json.length > 0 }}` — ou simplesmente rotear para respondToWebhook independente do resultado.

Se o Postgres retornar 0 linhas, retornar `[]` diretamente (não erro).

---

## Nó respondToWebhook — com resultados

**respondWith:** `json`  
**responseBody:** `={{ $input.all().map(item => item.json) }}`

---

## Nó respondToWebhook — sem resultados (array vazio)

**respondWith:** `json`  
**responseBody:** `=[]`

---

## Validação de segurança

O nó `Validador JWT Cliente` já sobreescreve `item.body.usuario_id = payloadObj.usuario_id`.  
Isso significa que mesmo que o frontend envie um `usuario_id` diferente, o validador corrige para o ID do usuário autenticado.  
**Não é necessário nenhuma validação extra neste novo ramo.**

---

## Teste

POST para `https://giif-api.duckdns.org/api-gateway` com header `Authorization: Bearer <JWT>`:

```json
{
  "acao": "listar_responsaveis_mapa",
  "usuario_id": "ID_DO_USUARIO"
}
```

Resposta esperada (com consultores vinculados):
```json
[
  { "id": "uuid-consultor", "nome_completo": "João Silva" }
]
```

Resposta esperada (sem vínculos):
```json
[]
```
