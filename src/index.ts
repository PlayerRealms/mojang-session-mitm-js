import { Client } from './driver/mysql'

type Environment = {
  readonly DB_HOST: string
  readonly DB_USERNAME: string
  readonly DB_PASSWORD: string
  readonly DB_NAME: string
  readonly CF_CLIENT_ID: string
  readonly CF_CLIENT_SECRET: string
}

export default {
  async fetch(request: Request, env: Environment, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/session/minecraft/hasJoined')) {
      return hasJoined(request, env, ctx);
    }
    if (pathname.startsWith('//session/minecraft/hasJoined')) {
      return hasJoined(request, env, ctx);
    }
    
    const response = await mitm(request);
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};

async function mysqlClient(env: Environment) {
  const mysql = new Client();
  const mysqlClient = await mysql.connect({
    hostname: env.DB_HOST,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    db: env.DB_NAME,
    cfClientId: env.CF_CLIENT_ID || undefined,
    cfClientSecret: env.CF_CLIENT_SECRET || undefined,
  });
  return mysqlClient
};

async function mitm(request: Request) {
  const options = {
    method: request.method,
    headers: request.headers,
  };

  const url = new URL(request.url);
  url.hostname = 'sessionserver.mojang.com';

  const response = await fetch(url.toString(), options);
  return response;
};

async function hasJoined(request: Request, env: Environment, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const username = url.searchParams.get('username');
  const serverId = url.searchParams.get('serverId');
  const ip = url.searchParams.get('ip');

  if (!username || !serverId ) {
    return new Response('', { status: 204 });
  }

  let mysql;
  try {
    // fetch uuid
    // TODO: change to mysql, redis, or another api
    const uuid_fetch = await fetch(`https://minecraft-api.com/api/uuid/${username}`);
    const uuid = await uuid_fetch.text();

    if (uuid === 'Player not found!') {
      throw new Error('the user is not found');
    }

    const uuid_regex = uuid.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5');

    // check the user is online
    mysql = await mysqlClient(env);
    const sql = `SELECT status FROM players WHERE uuid = '${uuid_regex}';`;

    const result = await mysql.query(sql);
    if (result === null) {
      throw new Error('the user is not never joined');
    }

    const status = (result as any)[0].status;
    if (status !== 1) {
      throw new Error('the user is not online');
    }
    await mysql.close();

    const skin_fetch = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
    const skin_json = await skin_fetch.json();
    const skin = (skin_json as any).properties[0].value;

    const response = {
      id: uuid,
      name: username,
      properties: [
        {
          name: 'textures',
          value: skin,
          signature: '',
        },
      ],
      profileActions: []
    };
    const body = JSON.stringify(response);
    console.log(body);

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
      },
    });
  } catch (e) {
    console.error((e as Error).message);

    if (mysql) {
      await (mysql as Client).close();
    }

    // fallback to mojang
    const response = await mitm(request);
    const body = await response.text();
    console.log(body);

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}