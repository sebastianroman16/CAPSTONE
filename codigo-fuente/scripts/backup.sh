#!/bin/sh
set -eu
output_dir="${1:-./backups}"
mkdir -p "$output_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose -f compose.production.yaml exec -T postgres pg_dump -U lex_corpus -d lex_corpus -Fc > "$output_dir/lex-corpus-$timestamp.dump"
docker run --rm -v lex-corpus_document_data:/source:ro -v "$(cd "$output_dir" && pwd)":/backup alpine tar -czf "/backup/lex-corpus-documents-$timestamp.tar.gz" -C /source .
echo "Respaldo creado en $output_dir con marca $timestamp"
