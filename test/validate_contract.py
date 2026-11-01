#!/usr/bin/env python3
"""Valida o contrato OpenAPI do OpenOnco-Trace.

Sem argumentos: só checa a estrutura da especificação.
Com o arquivo gerado por test/contract.test.js: também confere cada resposta e
requisição capturada contra os schemas do OpenAPI.

Dependências: PyYAML e jsonschema (pip install pyyaml jsonschema).
"""
import json
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = ROOT / "openapi" / "openonco-trace.v1.yaml"
SPEC_URI = SPEC_PATH.as_uri()
METHODS = {"get", "put", "post", "delete", "patch", "head", "options"}

spec = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))
sample_schema = json.loads((ROOT / "openapi" / "schemas" / "OpenOncoSample.json").read_text(encoding="utf-8"))


def retrieve(uri):
    """Carrega recursos referenciados pelo contrato (arquivos locais e o $id do schema da amostra)."""
    if uri == sample_schema.get("$id") or uri.endswith("/schemas/OpenOncoSample.json"):
        return Resource.from_contents(sample_schema, default_specification=DRAFT202012)
    if uri == SPEC_URI:
        return Resource(contents=spec, specification=DRAFT202012)
    raise LookupError(f"Referência não resolvível: {uri}")


registry = Registry(retrieve=retrieve)
failures = []


def fail(msg):
    failures.append(msg)
    print(f"FAIL  {msg}")


def ok(msg):
    print(f"PASS  {msg}")


def resolve_local(ref):
    node = spec
    for part in ref.lstrip("#/").split("/"):
        node = node[part.replace("~1", "/").replace("~0", "~")]
    return node


def validator_for(pointer):
    return Draft202012Validator({"$ref": f"{SPEC_URI}{pointer}"}, registry=registry, format_checker=Draft202012Validator.FORMAT_CHECKER)


def check_structure():
    """Checagens estruturais (sem depender de um linter OpenAPI externo)."""
    if not str(spec.get("openapi", "")).startswith("3.1"):
        fail("campo openapi deve ser 3.1.x")
    for key in ("title", "version"):
        if not spec.get("info", {}).get(key):
            fail(f"info.{key} ausente")

    # Toda referência local precisa existir.
    def walk(node, where):
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/"):
                try:
                    resolve_local(ref)
                except (KeyError, TypeError):
                    fail(f"$ref quebrada em {where}: {ref}")
            for k, v in node.items():
                walk(v, f"{where}/{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{where}/{i}")
    walk(spec, "#")

    op_ids = []
    for route, item in spec["paths"].items():
        for method, op in item.items():
            if method not in METHODS:
                continue
            if not op.get("operationId"):
                fail(f"{method.upper()} {route} sem operationId")
            op_ids.append(op.get("operationId"))
            if not op.get("responses"):
                fail(f"{method.upper()} {route} sem respostas")
            for scheme in (s for req in op.get("security", []) for s in req):
                if scheme not in spec["components"].get("securitySchemes", {}):
                    fail(f"{method.upper()} {route} usa esquema de segurança inexistente: {scheme}")
    if len(op_ids) != len(set(op_ids)):
        fail("operationId duplicado")

    # Todo schema de componente precisa ser JSON Schema 2020-12 válido e resolvível.
    for name in spec["components"]["schemas"]:
        try:
            Draft202012Validator.check_schema(spec["components"]["schemas"][name])
            validator_for(f"#/components/schemas/{name}").is_valid(None)
        except Exception as exc:  # noqa: BLE001
            fail(f"schema {name} inválido: {exc}")
    Draft202012Validator.check_schema(sample_schema)
    if not failures:
        ok(f"estrutura do OpenAPI: {len(op_ids)} operações, {len(spec['components']['schemas'])} schemas, referências resolvidas")


def response_spec(method, path, status):
    op = spec["paths"].get(path, {}).get(method)
    if op is None:
        return None, None
    resp = op["responses"].get(str(status))
    pointer = f"#/paths/{path.replace('~', '~0').replace('/', '~1')}/{method}/responses/{status}"
    if resp and "$ref" in resp:
        pointer = resp["$ref"]
        resp = resolve_local(resp["$ref"])
    return resp, pointer


def check_exchanges(capture):
    for ex in capture["exchanges"]:
        label = f"{ex['name']}: {ex['method'].upper()} {ex['path']} → {ex['status']}"
        resp, pointer = response_spec(ex["method"], ex["path"], ex["status"])
        if resp is None:
            fail(f"{label} não está documentado no contrato")
            continue
        errors = []
        if "content" in resp:
            v = validator_for(f"{pointer}/content/application~1json/schema")
            errors += [f"{'/'.join(map(str, e.absolute_path)) or '(raiz)'}: {e.message}" for e in v.iter_errors(ex["body"])]
        for header, hdef in resp.get("headers", {}).items():
            if "$ref" in hdef:
                hdef = resolve_local(hdef["$ref"])
            value = ex["headers"].get(header.lower())
            if value is None:
                if hdef.get("required"):
                    errors.append(f"cabeçalho obrigatório ausente: {header}")
                continue
            if not Draft202012Validator(hdef.get("schema", {})).is_valid(value):
                errors.append(f"cabeçalho {header} fora do schema: {value}")
        if errors:
            fail(f"{label}\n        " + "\n        ".join(errors[:8]))
        else:
            ok(label)

    req_validator = validator_for("#/paths/~1custody~1validate/post/requestBody/content/application~1json/schema")
    for req in capture["requests"]:
        errors = [f"{'/'.join(map(str, e.absolute_path)) or '(raiz)'}: {e.message}" for e in req_validator.iter_errors(req["body"])]
        label = f"requisição gerada pelo SDK ({'com' if 'X-API-Key' in req['headers'] else 'sem'} chave) segue ValidateRequest"
        fail(f"{label}\n        " + "\n        ".join(errors)) if errors else ok(label)

    # Cada código de status documentado em /custody/validate foi exercitado?
    documented = set(spec["paths"]["/custody/validate"]["post"]["responses"])
    seen = {str(e["status"]) for e in capture["exchanges"] if e["path"] == "/custody/validate"}
    missing = documented - seen
    fail(f"status documentados sem teste: {sorted(missing)}") if missing else ok(f"todos os status de /custody/validate exercitados: {sorted(documented)}")


if __name__ == "__main__":
    check_structure()
    if len(sys.argv) > 1:
        check_exchanges(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    print(f"\n{'Contrato OK' if not failures else f'{len(failures)} falha(s) no contrato'}")
    sys.exit(1 if failures else 0)
