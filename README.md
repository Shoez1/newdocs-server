# NewDocs

Mini "WeTransfer" (sem conta): envie arquivos e gere um link para download.

## Requisitos

- Node.js 18+ (recomendado)

## Rodar local

1. Instale dependências:

```bash
npm install
```

2. Crie o `.env` (opcional, recomendado em hospedagem):

- Copie `.env.example` para `.env`
- Configure `BASE_URL` com o domínio público

3. Inicie:

```bash
npm run dev
```

Acesse:

- `http://localhost:3000`

## Hospedagem (Serv00.net)

O Serv00 roda Node.js via **Phusion Passenger**.

1. No painel do Serv00:

- Adicione/configure seu domínio no DNS
- Crie o site WWW com o tipo: `nodejs`

2. Envie o projeto para a pasta do domínio (via SFTP/SSH):

- `/usr/home/SEU_LOGIN/domains/SEU_DOMINIO/public_nodejs`

3. Garanta que o entrypoint exista:

- O Serv00 espera um `app.js` na raiz (já está no projeto)

4. Instale dependências no servidor (via SSH) dentro de `public_nodejs`:

```bash
npm install
```

5. Configure variáveis:

- Opção A (mais simples): crie um `.env` baseado no `.env.example`
- Opção B (recomendado pelo Serv00 p/ Passenger): exporte variáveis no `~/.bash_profile`

Obrigatório em produção:

- `BASE_URL=https://SEU_DOMINIO`

6. Reinicie o app:

```bash
devil www restart SEU_DOMINIO
```

7. Logs:

- `/usr/home/SEU_LOGIN/domains/SEU_DOMINIO/logs/error.log`

Observações:

- As pastas `storage/` e `data/` precisam de permissão de escrita
- Se ficar 24h sem visitas, o Serv00 pode “dormir” o app e ele volta sozinho na próxima visita

## Hospedagem (genérica)

- Rode com `npm start`
- Garanta que a pasta do app tenha permissão de escrita (para `storage/` e `data/`)
- Configure `BASE_URL=https://seu-dominio.com` para os links saírem corretos

## Variáveis (.env)

- `PORT`: porta do servidor
- `BASE_URL`: URL pública (ex: `https://meusite.com`)
- `MAX_UPLOAD_MB`: limite por arquivo em MB
- `EXPIRE_HOURS`: expiração do link
- `MAX_FILES`: máximo de arquivos por envio
- `STORAGE_DIR` e `DATA_DIR`: caminhos opcionais
