import unittest
from study import paired_summary
from trace_metrics import activations
from completion import completion_reason


class StudyTests(unittest.TestCase):
    def test_idle_guard_stop_is_not_a_completed_task(self):
        result = {'kind': 'litellm-specific', 'status': 'idle', 'acceptance': {'passed': True},
                  'final': 'I stopped because the model requested the same tools three times in a row. The third batch was not executed.'}
        self.assertEqual(completion_reason(result), 'repeated-tools-guard')
        result['final'] = '[Stopped: several rounds produced no new information. Summarize what was learned and what is blocking.]'
        self.assertEqual(completion_reason(result), 'no-progress-guard')
        result['final'] = '   '
        self.assertEqual(completion_reason(result), 'empty-handoff')
        result['final'] = 'Implemented and verified the change.'
        self.assertEqual(completion_reason(result), 'completed')
        result['timedOut'] = True
        self.assertEqual(completion_reason(result), 'timeout')

    def test_activation_requires_observed_payload(self):
        messages = [{'role': 'system', 'content': 'LiteLLM starting locations\n<workspace_reference>\n{"playbooks":[{"id":"router"}]}\n</workspace_reference>'},
                    {'role': 'system', 'content': 'LiteLLM change review.'}]
        calls = [{'name': 'read_file', 'args': {}}, {'name': 'read_file', 'args': {'limit': 20}},
                 {'name': 'litellm_context', 'output': '{"playbooks":[{"id":"router"}]}'},
                 {'name': 'litellm_context', 'output': 'truncated'}]
        result = activations(messages, calls)
        self.assertEqual(result['guideIdsShown'], ['router'])
        self.assertEqual(result['finalReviewNotices'], 1)
        self.assertIsNone(result['defaultWindowReadCalls'])
        self.assertEqual(result['readCallsByEffectiveLimit'], {'missing': 1, '20': 1})
        self.assertEqual(result['unparsedContextPayloads'], 1)

    def test_incomplete_pair_is_not_compared(self):
        rows = []
        for case in ['a', 'b']:
            for name, success in [('control', False), ('no-guides', True)]:
                for _ in range(2):
                    rows.append(dict(dataset='', case=case, name=name, evaluated=True, success=success, seconds=1))
        result = paired_summary(rows, 2)[0]
        self.assertTrue(result['complete'])
        self.assertEqual(result['successDelta'], 1)
        self.assertEqual(result['taskBootstrap95'], [1, 1])
        rows[-1]['evaluated'] = False
        result = paired_summary(rows, 2)[0]
        self.assertFalse(result['complete'])
        self.assertEqual(result['pairedTasks'], 1)


if __name__ == '__main__':
    unittest.main()
