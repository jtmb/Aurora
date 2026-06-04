module.exports = {

"[externals]/ [external] (next/dist/compiled/next-server/app-route.runtime.dev.js, cjs)": (function(__turbopack_context__) {

var { r: __turbopack_require__, f: __turbopack_module_context__, i: __turbopack_import__, s: __turbopack_esm__, v: __turbopack_export_value__, n: __turbopack_export_namespace__, c: __turbopack_cache__, M: __turbopack_modules__, l: __turbopack_load__, j: __turbopack_dynamic__, P: __turbopack_resolve_absolute_path__, U: __turbopack_relative_url__, R: __turbopack_resolve_module_id_path__, b: __turbopack_worker_blob_url__, g: global, __dirname, x: __turbopack_external_require__, y: __turbopack_external_import__, m: module, e: exports, t: require } = __turbopack_context__;
{
const mod = __turbopack_external_require__("next/dist/compiled/next-server/app-route.runtime.dev.js");

module.exports = mod;
}}),
"[externals]/ [external] (@opentelemetry/api, cjs)": (function(__turbopack_context__) {

var { r: __turbopack_require__, f: __turbopack_module_context__, i: __turbopack_import__, s: __turbopack_esm__, v: __turbopack_export_value__, n: __turbopack_export_namespace__, c: __turbopack_cache__, M: __turbopack_modules__, l: __turbopack_load__, j: __turbopack_dynamic__, P: __turbopack_resolve_absolute_path__, U: __turbopack_relative_url__, R: __turbopack_resolve_module_id_path__, b: __turbopack_worker_blob_url__, g: global, __dirname, x: __turbopack_external_require__, y: __turbopack_external_import__, m: module, e: exports, t: require } = __turbopack_context__;
{
const mod = __turbopack_external_require__("@opentelemetry/api");

module.exports = mod;
}}),
"[externals]/ [external] (next/dist/compiled/next-server/app-page.runtime.dev.js, cjs)": (function(__turbopack_context__) {

var { r: __turbopack_require__, f: __turbopack_module_context__, i: __turbopack_import__, s: __turbopack_esm__, v: __turbopack_export_value__, n: __turbopack_export_namespace__, c: __turbopack_cache__, M: __turbopack_modules__, l: __turbopack_load__, j: __turbopack_dynamic__, P: __turbopack_resolve_absolute_path__, U: __turbopack_relative_url__, R: __turbopack_resolve_module_id_path__, b: __turbopack_worker_blob_url__, g: global, __dirname, x: __turbopack_external_require__, y: __turbopack_external_import__, m: module, e: exports, t: require } = __turbopack_context__;
{
const mod = __turbopack_external_require__("next/dist/compiled/next-server/app-page.runtime.dev.js");

module.exports = mod;
}}),
"[externals]/ [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)": (function(__turbopack_context__) {

var { r: __turbopack_require__, f: __turbopack_module_context__, i: __turbopack_import__, s: __turbopack_esm__, v: __turbopack_export_value__, n: __turbopack_export_namespace__, c: __turbopack_cache__, M: __turbopack_modules__, l: __turbopack_load__, j: __turbopack_dynamic__, P: __turbopack_resolve_absolute_path__, U: __turbopack_relative_url__, R: __turbopack_resolve_module_id_path__, b: __turbopack_worker_blob_url__, g: global, __dirname, x: __turbopack_external_require__, y: __turbopack_external_import__, m: module, e: exports, t: require } = __turbopack_context__;
{
const mod = __turbopack_external_require__("next/dist/server/app-render/work-unit-async-storage.external.js");

module.exports = mod;
}}),
"[externals]/ [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)": (function(__turbopack_context__) {

var { r: __turbopack_require__, f: __turbopack_module_context__, i: __turbopack_import__, s: __turbopack_esm__, v: __turbopack_export_value__, n: __turbopack_export_namespace__, c: __turbopack_cache__, M: __turbopack_modules__, l: __turbopack_load__, j: __turbopack_dynamic__, P: __turbopack_resolve_absolute_path__, U: __turbopack_relative_url__, R: __turbopack_resolve_module_id_path__, b: __turbopack_worker_blob_url__, g: global, __dirname, x: __turbopack_external_require__, y: __turbopack_external_import__, m: module, e: exports, t: require } = __turbopack_context__;
{
const mod = __turbopack_external_require__("next/dist/server/app-render/work-async-storage.external.js");

module.exports = mod;
}}),
"[project]/apps/web/app/api/providers/models/route.js [app-route] (ecmascript)": ((__turbopack_context__) => {
"use strict";

var { r: __turbopack_require__, f: __turbopack_module_context__, i: __turbopack_import__, s: __turbopack_esm__, v: __turbopack_export_value__, n: __turbopack_export_namespace__, c: __turbopack_cache__, M: __turbopack_modules__, l: __turbopack_load__, j: __turbopack_dynamic__, P: __turbopack_resolve_absolute_path__, U: __turbopack_relative_url__, R: __turbopack_resolve_module_id_path__, b: __turbopack_worker_blob_url__, g: global, __dirname, x: __turbopack_external_require__, y: __turbopack_external_import__, z: require } = __turbopack_context__;
{
// @aurora/api/providers/models - Get available models from configured providers
// API keys accepted via request headers (x-openai-key, x-anthropic-key, etc.)
__turbopack_esm__({
    "GET": (()=>GET)
});
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_import__("[project]/node_modules/next/server.js [app-route] (ecmascript)");
;
/**
 * Extract API keys from request headers
 */ const extractKeys = (request)=>({
        openai: request.headers.get('x-openai-key') || process.env.OPENAI_API_KEY || '',
        anthropic: request.headers.get('x-anthropic-key') || process.env.ANTHROPIC_API_KEY || '',
        ollamaBase: request.headers.get('x-ollama-base') || process.env.OLLAMA_API_BASE || 'http://localhost:11434',
        lmStudioUrl: request.headers.get('x-lmstudio-url') || '',
        lmStudioHost: process.env.LM_STUDIO_HOST || '',
        lmStudioPort: process.env.LM_STUDIO_PORT || ''
    });
/**
 * Fetch models from OpenAI
 */ const fetchOpenAIModels = async (apiKey)=>{
    if (!apiKey) return [];
    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) return [];
        const data = await response.json();
        return (data.data || []).map((m)=>({
                id: m.id,
                name: m.id,
                owned_by: 'openai',
                source: 'OpenAI'
            }));
    } catch  {
        return [];
    }
};
/**
 * Fetch models from Anthropic
 */ const fetchAnthropicModels = async (apiKey)=>{
    if (!apiKey) return [];
    try {
        const response = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            }
        });
        if (!response.ok) return [];
        const data = await response.json();
        return (data.data || []).map((m)=>({
                id: m.id,
                name: m.display_name || m.id,
                owned_by: 'anthropic',
                source: 'Anthropic'
            }));
    } catch  {
        return [];
    }
};
/**
 * Fetch models from Ollama
 */ const fetchOllamaModels = async (baseUrl)=>{
    try {
        const response = await fetch(`${baseUrl}/api/tags`);
        if (!response.ok) return [];
        const data = await response.json();
        return (data.models || []).map((m)=>({
                id: m.name,
                name: m.name,
                owned_by: 'ollama',
                source: 'Ollama'
            }));
    } catch  {
        return [];
    }
};
/**
 * Fetch models from LM Studio
 */ const fetchLmStudioModels = async (url)=>{
    if (!url) return [];
    try {
        const response = await fetch(`${url}/v1/models`);
        if (!response.ok) return [];
        const data = await response.json();
        const models = data.data || (Array.isArray(data) ? data : []);
        return models.map((m)=>({
                id: m.id,
                name: m.id,
                owned_by: 'lmstudio',
                source: 'LM Studio'
            }));
    } catch  {
        return [];
    }
};
async function GET(request) {
    try {
        const keys = extractKeys(request);
        // Fetch models from all available providers in parallel
        const [openaiModels, anthropicModels, ollamaModels, lmStudioModels] = await Promise.all([
            fetchOpenAIModels(keys.openai),
            fetchAnthropicModels(keys.anthropic),
            fetchOllamaModels(keys.ollamaBase),
            fetchLmStudioModels(keys.lmStudioUrl)
        ]);
        const allModels = [
            ...openaiModels,
            ...anthropicModels,
            ...ollamaModels,
            ...lmStudioModels
        ];
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            models: allModels,
            providers: {
                openai: !!keys.openai,
                anthropic: !!keys.anthropic,
                ollama: true,
                lmstudio: !!(keys.lmStudioUrl || keys.lmStudioHost)
            }
        });
    } catch (error) {
        console.error('[Aurora] Models fetch error:', error.message);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            models: [],
            error: error.message
        });
    }
}
}}),
"[project]/apps/web (server-utils)": ((__turbopack_context__) => {

var { r: __turbopack_require__, f: __turbopack_module_context__, i: __turbopack_import__, s: __turbopack_esm__, v: __turbopack_export_value__, n: __turbopack_export_namespace__, c: __turbopack_cache__, M: __turbopack_modules__, l: __turbopack_load__, j: __turbopack_dynamic__, P: __turbopack_resolve_absolute_path__, U: __turbopack_relative_url__, R: __turbopack_resolve_module_id_path__, b: __turbopack_worker_blob_url__, g: global, __dirname, t: require } = __turbopack_context__;
{
}}),

};

//# sourceMappingURL=%5Broot%20of%20the%20server%5D__e1f258._.js.map