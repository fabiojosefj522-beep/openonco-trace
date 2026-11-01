# Política de segurança

O OpenOnco-Trace lida com rastreabilidade de material biológico usado em terapias contra o câncer. Falhas aqui podem afetar pacientes, então levamos relatos a sério.

## Versões com suporte

| Versão | Suporte |
|---|---|
| 1.x | Correções de segurança |

## Como reportar uma vulnerabilidade

**Não abra issue pública.** Use o reporte privado do GitHub: aba **Security** do repositório > **Report a vulnerability**.

Inclua:
- componente afetado (`@openonco/sdk`, `@openonco/badge`, contrato OpenAPI ou mock);
- passos para reproduzir e impacto esperado;
- versão ou commit.

Prazos de referência: confirmação do recebimento em até 3 dias úteis, avaliação inicial em até 10 dias úteis e divulgação coordenada depois que a correção for publicada.

## Escopo

Dentro do escopo:
- quebra da verificação de selos (hash, assinatura ou vínculo selo/registro);
- desvio da validação de schema que permita PHI ou dados malformados;
- XSS no `<onco-badge>`;
- vazamento de dados para fora do domínio configurado.

Fora do escopo:
- o mock em `mock/enterprise-mock.js`, que é uma simulação e não deve ir para produção;
- valores ilustrativos de perfis térmicos;
- problemas que exigem expor a API Key no navegador, o que a documentação proíbe.

## Boas práticas para quem integra

- Mantenha a API Key no backend (BFF/proxy) ou use tokens OAuth2 de curta duração.
- Use apenas IDs pseudonimizados de paciente.
- Verifique os selos recebidos com `sdk.verifyReceipt()`. O SDK já faz isso em cada resposta 200.
