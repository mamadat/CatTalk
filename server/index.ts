import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTranslationServer } from './app';
import { createOpenAIProvider, DEFAULT_MODELS } from './provider';

if (existsSync('.env')) process.loadEnvFile('.env');
const host=process.env.TRANSLATION_HOST || '127.0.0.1';
const port=Number(process.env.TRANSLATION_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TRANSLATION_PORT');
const token=process.env.TRANSLATION_ACCESS_TOKEN?.trim();
if (!['127.0.0.1','localhost','::1'].includes(host) && !token) throw new Error('Set TRANSLATION_ACCESS_TOKEN before exposing the server beyond localhost.');
const apiKey=process.env.OPENAI_API_KEY?.trim() || '';
const models={balanced:process.env.OPENAI_TRANSLATION_MODEL || DEFAULT_MODELS.balanced, quality:process.env.OPENAI_TRANSLATION_QUALITY_MODEL || DEFAULT_MODELS.quality, fast:process.env.OPENAI_TRANSLATION_FAST_MODEL || DEFAULT_MODELS.fast};
const origins=(process.env.TRANSLATION_ALLOWED_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port},http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082`).split(',').map((v:string) => v.trim()).filter(Boolean);
const server=createTranslationServer({configured:!!apiKey,models,accessToken:token,allowedOrigins:origins,staticDirectory:resolve('dist')},createOpenAIProvider({apiKey,models}));
server.requestTimeout=15000;
server.headersTimeout=10000;
server.listen(port,host,() => {
  console.log(`CatTalk translation + web: http://${host}:${port}`);
  console.log(apiKey ? 'Translation provider configured.' : 'Translation inactive: add OPENAI_API_KEY to .env, then restart.');
});
server.on('error',error => {console.error(error.message);process.exitCode=1;});
