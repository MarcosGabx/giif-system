#!/usr/bin/env python3
"""
GIIF System — n8n Workflow Bug Fixer
Applies Bugs 1, 2, and 4 fixes to the workflow JSON.

Usage:
    python fix_workflow.py "GIIF - Motor 3 Camadas (Inicial, Premium, Global) (24).json"
    python fix_workflow.py input.json output.json   # explicit output path
"""
import json
import re
import sys
import os

# ─── Node names to fix ────────────────────────────────────────────────────────

PROMPT_APROF_NODES = [
    'Prompt Comercial Aprof.1',
    'Prompt Estratégico Aprof.1',
    'Prompt Financeiro Aprof.1',
    'Prompt Marketing Aprof.1',
    'Prompt Pessoas Aprof.1',
]

LIMPAR_JSON_NODES = [
    'Limpar Saída JSON Aprof.1',
    'Limpar Saída JSON Global',
    '7. Limpar Saída JSON',
]

# Fields that are JSONB objects — must be serialized before embedding in a string prompt
OBJECT_FIELDS = [
    'dados_normalizados',
    'indicadores',
    'qualidade_dados',
    'scores_c1',
    'resumo_estruturado',
]

# ─── Bug 2: Robust JSON parser replacement ────────────────────────────────────

ROBUST_PARSER = """\
let raw = ($json.text || '').trim();
      // Robustly extract JSON from markdown code block anywhere in the response
      const jsonBlockMatch = raw.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
      if (jsonBlockMatch) {
        raw = jsonBlockMatch[1].trim();
      } else {
        // Fallback: extract outermost { ... } if no code block found
        const firstBrace = raw.indexOf('{');
        const lastBrace = raw.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          raw = raw.slice(firstBrace, lastBrace + 1).trim();
        }
      }"""

# ─── Bug 4: Anti-refusal instruction appended to system prompts ───────────────

ANTI_REFUSAL_SUFFIX = """

INSTRUÇÃO CRÍTICA — NUNCA RECUSE A ANÁLISE:
Mesmo que os dados estejam ausentes, incompletos ou em formato inesperado, SEMPRE entregue uma análise qualitativa profissional. Se dados específicos estiverem faltando, baseie-se nos dados disponíveis e indique claramente as limitações, mas NUNCA retorne uma recusa ou bloco de "CONDIÇÃO CRÍTICA". O objetivo é sempre agregar valor analítico ao usuário, independentemente da qualidade dos dados de entrada."""


# ─── Helpers ──────────────────────────────────────────────────────────────────

def fix_bug1_set_node(node):
    """Replace bare {{ $json.field }} with JSON.stringify(...) in Prompt Aprof nodes."""
    changed = False
    params = node.get('parameters', {})

    # typeVersion 3.4 stores fields under assignments.assignments[].value
    assignments_container = params.get('assignments', {})
    if isinstance(assignments_container, dict):
        assignments = assignments_container.get('assignments', [])
        for assignment in assignments:
            if not isinstance(assignment, dict):
                continue
            original = assignment.get('value', '')
            if not isinstance(original, str):
                continue
            updated = original
            for field in OBJECT_FIELDS:
                old = '{{ $json.' + field + ' }}'
                new = '{{ JSON.stringify($json.' + field + ' || {}, null, 2) }}'
                updated = updated.replace(old, new)
            if updated != original:
                assignment['value'] = updated
                changed = True

    # Older typeVersion may use a flat dict under "values" or top-level keys
    for key, val in params.items():
        if key in ('assignments',):
            continue
        if isinstance(val, str):
            updated = val
            for field in OBJECT_FIELDS:
                old = '{{ $json.' + field + ' }}'
                new = '{{ JSON.stringify($json.' + field + ' || {}, null, 2) }}'
                updated = updated.replace(old, new)
            if updated != val:
                params[key] = updated
                changed = True

    return changed


def fix_bug2_code_node(node):
    """Replace fragile backtick-strip regex with robust JSON extractor."""
    params = node.get('parameters', {})
    code = params.get('jsCode', '')
    if not isinstance(code, str):
        return False

    # Pattern 1: multi-line chained replace
    # let raw = ($json.text || '').trim()\n<whitespace>.replace(/^```json...
    pattern1 = re.compile(
        r"let raw = \(\$json\.text \|\| ''\)\.trim\(\)\s*"
        r"\.replace\(/\^```json[^;]{0,200}\.trim\(\);",
        re.DOTALL
    )
    new_code, count = pattern1.subn(ROBUST_PARSER + ';', code)
    if count:
        params['jsCode'] = new_code
        return True

    # Pattern 2: single-line version
    pattern2 = re.compile(
        r"let raw = \(\$json\.text \|\| ''\)\.trim\(\)"
        r"\.replace\(/\^```json[^;]{0,200};",
        re.DOTALL
    )
    new_code, count = pattern2.subn(ROBUST_PARSER + ';', code)
    if count:
        params['jsCode'] = new_code
        return True

    return False


def fix_bug4_chainllm_node(node):
    """Append anti-refusal instruction to chainLlm system prompt."""
    params = node.get('parameters', {})
    changed = False

    # Common parameter name for system message in @n8n/n8n-nodes-langchain.chainLlm
    for key in ('systemMessage', 'system_message', 'prompt', 'text'):
        val = params.get(key)
        if isinstance(val, str) and val.strip() and ANTI_REFUSAL_SUFFIX.strip() not in val:
            params[key] = val.rstrip() + ANTI_REFUSAL_SUFFIX
            changed = True
            break

    # Some chainLlm nodes nest it under messages[]
    messages = params.get('messages', {})
    if isinstance(messages, dict):
        msg_list = messages.get('messageValues', []) or messages.get('values', [])
        for msg in msg_list:
            if isinstance(msg, dict) and msg.get('type') in ('system', 'SystemMessage', None):
                content = msg.get('message', '') or msg.get('content', '')
                if isinstance(content, str) and content.strip() and ANTI_REFUSAL_SUFFIX.strip() not in content:
                    key_to_update = 'message' if 'message' in msg else 'content'
                    msg[key_to_update] = content.rstrip() + ANTI_REFUSAL_SUFFIX
                    changed = True

    return changed


# ─── Identify IA Camada 2/3 chainLlm nodes ───────────────────────────────────

IA_APROF_NODE_NAMES = [
    'IA Estratégia', 'IA Estrategia',
    'IA Finanças', 'IA Financas',
    'IA Comercial',
    'IA Marketing',
    'IA Pessoas',
    'IA Camada 2',
    'IA Camada 3',
    'IA Global',
]


def is_ia_aprof_node(node):
    name = node.get('name', '')
    node_type = node.get('type', '')
    return (
        'chainLlm' in node_type or 'lmChatOpenAi' in node_type or 'lmChatAnthropic' in node_type
    ) and any(partial.lower() in name.lower() for partial in IA_APROF_NODE_NAMES)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    input_path = sys.argv[1]
    if not os.path.isfile(input_path):
        print(f"ERROR: File not found: {input_path}")
        sys.exit(1)

    output_path = sys.argv[2] if len(sys.argv) > 2 else (
        os.path.splitext(input_path)[0] + '_FIXED.json'
    )

    print(f"Loading: {input_path}")
    with open(input_path, 'r', encoding='utf-8') as f:
        workflow = json.load(f)

    nodes = workflow.get('nodes', [])
    print(f"Nodes found: {len(nodes)}\n")

    bug1_fixed = []
    bug2_fixed = []
    bug4_fixed = []

    for node in nodes:
        name = node.get('name', '(unnamed)')

        if name in PROMPT_APROF_NODES:
            if fix_bug1_set_node(node):
                bug1_fixed.append(name)

        if name in LIMPAR_JSON_NODES:
            if fix_bug2_code_node(node):
                bug2_fixed.append(name)
            else:
                print(f"  [WARN] Bug2: pattern not matched in '{name}' — check manually")

        if is_ia_aprof_node(node):
            if fix_bug4_chainllm_node(node):
                bug4_fixed.append(name)

    # Report
    print("=== Bug 1 (JSON.stringify in Set nodes) ===")
    if bug1_fixed:
        for n in bug1_fixed:
            print(f"  FIXED: {n}")
    else:
        print("  [WARN] No matching Prompt Aprof nodes found — verify node names")

    print("\n=== Bug 2 (Robust JSON parser) ===")
    if bug2_fixed:
        for n in bug2_fixed:
            print(f"  FIXED: {n}")
    else:
        print("  [WARN] No Limpar JSON nodes matched — check node names and code format")

    print("\n=== Bug 4 (Anti-refusal instructions) ===")
    if bug4_fixed:
        for n in bug4_fixed:
            print(f"  FIXED: {n}")
    else:
        print("  [WARN] No IA chainLlm nodes matched — verify node names/types")

    total = len(bug1_fixed) + len(bug2_fixed) + len(bug4_fixed)
    print(f"\nTotal fixes applied: {total}")

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(workflow, f, ensure_ascii=False, indent=2)

    print(f"\nSaved: {output_path}")
    print("Import this file into n8n to apply the fixes.")


if __name__ == '__main__':
    main()
