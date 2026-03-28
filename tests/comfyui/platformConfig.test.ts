import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMFY_UI_BUILTIN_PRESETS,
  detectNodeMappingsFromWorkflow,
  parseWorkflowIdFromInput,
} from '../../app/lib/comfyui/platformConfig';

test('parseWorkflowIdFromInput extracts runninghub workflow id', () => {
  assert.equal(
    parseWorkflowIdFromInput('https://www.runninghub.cn/task/abc123_xyz'),
    'abc123_xyz',
  );
});

test('parseWorkflowIdFromInput extracts liblib workflow id', () => {
  assert.equal(
    parseWorkflowIdFromInput('https://www.liblib.art/workflow/flux-demo-01'),
    'flux-demo-01',
  );
});

test('parseWorkflowIdFromInput keeps raw id when input is plain text', () => {
  assert.equal(parseWorkflowIdFromInput('manual_workflow_id'), 'manual_workflow_id');
});

test('detectNodeMappingsFromWorkflow finds prompt, refImage and output nodes', () => {
  const mappings = detectNodeMappingsFromWorkflow({
    '3': { class_type: 'LoadImage', inputs: { image: 'ref.png' } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'cinematic frame' } },
    '12': { class_type: 'SaveVideo', inputs: { video: ['11', 0] } },
  });

  assert.deepEqual(mappings, [
    { role: 'prompt', nodeId: '6', field: 'text', nodeType: 'CLIPTextEncode' },
    { role: 'refImage', nodeId: '3', field: 'image', nodeType: 'LoadImage' },
    { role: 'output', nodeId: '12', field: 'video', nodeType: 'SaveVideo' },
  ]);
});

test('builtin presets include official platform-specific starter workflows', () => {
  assert.deepEqual(
    COMFY_UI_BUILTIN_PRESETS.map((item) => item.id),
    ['sdxl-txt2img', 'flux-img2img', 'hunyuan-video'],
  );
});
