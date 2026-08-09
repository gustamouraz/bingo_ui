# Bingo UI backend

Backend sem dependências externas para o painel de bingo de 75 bolas. As sessões são gravadas em `data/bingo-sessions.json`, criado automaticamente na primeira execução.

## Executar

Requer Node.js 18 ou superior.

```powershell
npm start
```

A API estará em `http://localhost:3000`.

## Endpoints

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/api/health` | Verifica o serviço. |
| GET | `/api/sessions` | Lista as sessões. |
| POST | `/api/sessions` | Cria uma sessão. |
| GET | `/api/sessions/:id` | Obtém o estado completo da sessão. |
| POST | `/api/sessions/:id/draw` | Sorteia uma bola ainda não chamada. |
| PATCH | `/api/sessions/:id/settings` | Atualiza `autoDraw` e `drawIntervalSeconds` (3 a 15). |
| POST | `/api/sessions/:id/reset` | Reinicia a sessão, preservando seus dados básicos. |
| POST | `/api/sessions/:id/close` | Encerra manualmente e arquiva a sessão. |
| DELETE | `/api/sessions/history` | Exclui permanentemente todas as sessões encerradas. |

Exemplo de criação:

```json
{ "name": "Noite de Bingo", "autoDraw": false, "drawIntervalSeconds": 5 }
```

O front-end controla o temporizador do auto-sorteio e chama `POST /draw` a cada intervalo. O servidor continua sendo a fonte de verdade: impede números repetidos e marca a sessão como concluída após a 75ª bola.
