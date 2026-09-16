"""Distinguish a normal answer from host guard stops that also leave an idle UI."""


def completion_reason(result):
    if result.get('timedOut'):
        return 'timeout'
    if result.get('interrupted'):
        return 'interrupted'
    if result.get('kind') == 'codex':
        return 'completed' if result.get('exit') == 0 else 'runner-error'
    if result.get('status') != 'idle':
        return 'runner-error'
    final = result.get('final') or ''
    if not final.strip():
        return 'empty-handoff'
    if final.startswith('I stopped because the model requested the same tools three times in a row.'):
        return 'repeated-tools-guard'
    if '[Stopped: several rounds produced no new information.' in final:
        return 'no-progress-guard'
    if any(marker in final for marker in ['[Some tasks are waiting on unresolved prerequisites.',
                                          '[Driver verification is incomplete.', 'worker assignment(s) remain unresolved.]']):
        return 'unresolved-work'
    return 'completed'
