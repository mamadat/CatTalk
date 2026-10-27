import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTranslationServer } from './app';
import { createProviderRegistry } from './providers';
import {createVoiceService} from './voice';
import {createVisionService} from './vision';
import {createMessagingService} from './messaging';

if (existsSync('.env')) process.loadEnvFile('.env');
const host=process.env.TRANSLATION_HOST || '127.0.0.1';
const port=Number(process.env.TRANSLATION_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TRANSLATION_PORT');
const token=process.env.TRANSLATION_ACCESS_TOKEN?.trim();
if (!['127.0.0.1','localhost','::1'].includes(host) && !token) throw new Error('Set TRANSLATION_ACCESS_TOKEN before exposing the server beyond localhost.');
const registry=createProviderRegistry(process.env);
const configured=Object.values(registry.providers).some(value=>value.configured);
const origins=(process.env.TRANSLATION_ALLOWED_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port},http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082`).split(',').map((v:string) => v.trim()).filter(Boolean);
const server=createTranslationServer({configured,models:registry.providers.openai.models,providers:registry.providers,refreshProviders:registry.refreshProviders,voice:createVoiceService(process.env),vision:createVisionService(process.env),messaging:createMessagingService(process.env),accessToken:token,allowedOrigins:origins,staticDirectory:resolve('dist')},registry.translate);
server.requestTimeout=15000;
server.headersTimeout=10000;
server.listen(port,host,() => {
  console.log(`CatTalk translation + web: http://${host}:${port}`);
  console.log(configured ? 'Cloud translation providers configured; local engines checked on demand.' : 'Run a local translation engine or add a cloud provider API key.');
});
server.on('error',error => {console.error(error.message);process.exitCode=1;});
