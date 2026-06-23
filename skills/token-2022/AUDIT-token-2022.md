# AUDITORIA — token-2022 skill (rodar antes de cada submissão)

Checklist repetível amarrado aos critérios reais do repo `sendaifun/skills`
(CONTRIBUTING.md + spec/SPECIFICATION.md) e à régua da bounty da Superteam Brasil.
Rode do topo até o fim. Qualquer item que falhe = corrige e roda tudo de novo.
A meta não é "aceito", é **top placement** — então cada item vale ponto.

## 0. Pré-checagem (a que mais derruba submissão)

- [ ] **Frescor da API**: cada export/função usada foi conferida contra a doc/lib ATUAL,
      não de memória. (Já feito nesta versão: typecheck limpo vs `@solana/spl-token@0.4.14`.)
- [ ] **Sem invenção**: nenhum nome de função, endpoint ou program id "achismo".
      Program ID Token-2022 = `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`.
- [ ] Reconferir se surgiu extension nova na doc oficial que valha citar
      (https://www.solana-program.com/docs/token-2022/extensions).

## 1. Conformidade com a spec (spec/SPECIFICATION.md)

- [ ] `SKILL.md` começa com frontmatter YAML com `name` e `description`.
- [ ] `name` = `token-2022` e bate com o nome da pasta (`skills/token-2022/`).
- [ ] `description` diz O QUE faz E QUANDO usar (gatilho pro agente carregar).
- [ ] Estrutura usa apenas `SKILL.md` + `resources/` + `examples/` (nomes da spec).

## 2. Checklist oficial do PR (CONTRIBUTING.md) — colar no corpo do PR

- [ ] Segue a estrutura do template.
- [ ] Instruções claras e sem ambiguidade (linguagem imperativa: "Faça X").
- [ ] Exemplos cobrem casos de uso comuns.
- [ ] Boas práticas de segurança seguidas.
- [ ] Testado com Claude Code ou agente compatível.
- [ ] Entrada adicionada em `.claude-plugin/marketplace.json` (ordem alfabética).

## 3. Qualidade que separa top 5 da média

- [ ] Exemplos são **copy-paste rodáveis** (não pseudocódigo) e passam em `tsc --noEmit`.
- [ ] Seção "Use / Do Not Use" + lista de **triggers** (igual jupiter/helius).
- [ ] `resources/` tem dado estático real: program IDs, tabela de extensions, erros.
- [ ] Considerações de **segurança** explícitas (PermanentDelegate, TransferHook, etc).
- [ ] Diferença **devnet vs mainnet** mencionada.
- [ ] Seção "Common Errors" com Causa + Solução para os erros reais.
- [ ] Profundidade comparável às skills aprovadas (alvo: ~200+ linhas no SKILL.md).

## 4. Teste funcional (faça de verdade, não só leia)

- [ ] Carregar a skill no Claude Code (`/plugin marketplace add <seu-fork>` e instalar).
- [ ] Pedir: "crie um token com 1% de taxa de transferência" → o agente referencia
      a skill e gera código alinhado ao exemplo.
- [ ] Rodar `create-token-with-transfer-fee.ts` na devnet com keypair descartável → confirma mint + taxa.
- [ ] Rodar `create-token-with-metadata.ts` na devnet → confirma metadata on-chain.
- [ ] Conferir no explorer (cluster=devnet) que o estado bate com o esperado.

## 5. Higiene do PR

- [ ] Branch `feat/token-2022`, commit `feat: add token-2022 skill`.
- [ ] NÃO commitar `node_modules`, lockfiles, `tsconfig.json` de teste.
- [ ] Título do PR descritivo; descrição com o checklist da seção 2 marcado.
- [ ] Linkar a bounty da Superteam no PR e, se pedirem, submeter o link do PR no Earn.

## 6. Loop de repetição

Se QUALQUER item acima falhar:
1. Corrige.
2. Roda o typecheck de novo (`tsc --noEmit`).
3. Re-roda esta auditoria do item 0.
Só submete quando passar 100%, duas vezes seguidas sem mudança.
