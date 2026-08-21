LITPROMPT ?= litprompt

# Layout: three source trees, two published trees.
#
#   skill-src/shared/   fragments imported by both variants; never built alone
#   skill-src/cli/      -> skills/          installable CLI/harness skills
#   skill-src/mcp/      -> mcp-skills/      MCP resource documents
#
#   skill-src/cli/webcmd-usage/SKILL.src.md -> skills/webcmd-usage/SKILL.md
#   skill-src/mcp/webcmd-usage.src.md       -> mcp-skills/webcmd-usage.md
#
# Source files are never named SKILL.md, and no generated MCP document is
# either: skill installers (`npx skills add`, harness scanners) match that
# literal filename, so an MCP document called SKILL.md would be installed as a
# duplicate CLI skill. litprompt.yaml cannot express a cross-tree rename, so
# builds run per file.
#
# `shared/` is excluded from both SOURCES lists on purpose. A fragment that
# appeared in a SOURCES list would be built into a standalone published file
# that no skill installer should ever see.
#
# This Makefile is the skill pipeline only. TypeScript still builds with npm.

SRC_TREE := skill-src
CLI_SRC  := $(SRC_TREE)/cli
MCP_SRC  := $(SRC_TREE)/mcp
CLI_PUB  := skills
MCP_PUB  := mcp-skills

CLI_SOURCES := $(shell find $(CLI_SRC) -name '*.src.md' 2>/dev/null | sort)
MCP_SOURCES := $(shell find $(MCP_SRC) -name '*.src.md' 2>/dev/null | sort)

.PHONY: build check verify orphans install-tool clean hash-generated undiscoverable

build:
	@test -n "$(CLI_SOURCES)" || { echo "ERROR: no *.src.md sources found under $(CLI_SRC)"; exit 1; }
	@for src in $(CLI_SOURCES); do \
		out=$$(echo "$$src" | sed 's|^$(CLI_SRC)/|$(CLI_PUB)/|; s|\.src\.md$$|.md|'); \
		mkdir -p "$$(dirname "$$out")"; \
		$(LITPROMPT) build "$$src" -o "$$out" -q || exit 1; \
		echo "  $$src -> $$out"; \
	done
	@for src in $(MCP_SOURCES); do \
		out=$$(echo "$$src" | sed 's|^$(MCP_SRC)/|$(MCP_PUB)/|; s|\.src\.md$$|.md|'); \
		mkdir -p "$$(dirname "$$out")"; \
		$(LITPROMPT) build "$$src" -o "$$out" -q || exit 1; \
		echo "  $$src -> $$out"; \
	done
	@echo "ok: built $(words $(CLI_SOURCES)) cli + $(words $(MCP_SOURCES)) mcp file(s)"

# Imports resolve, no cycles, nothing written. Covers shared/ too.
check:
	@$(LITPROMPT) check $(SRC_TREE) --match '**/*.src.md'

# Every published file must trace back to a source, in both trees.
orphans:
	@status=0; \
	for out in $$(find $(CLI_PUB) -name '*.md' 2>/dev/null | sort); do \
		src=$$(echo "$$out" | sed 's|^$(CLI_PUB)/|$(CLI_SRC)/|; s|\.md$$|.src.md|'); \
		if [ ! -f "$$src" ]; then echo "ORPHAN: $$out has no source at $$src"; status=1; fi; \
	done; \
	for out in $$(find $(MCP_PUB) -name '*.md' 2>/dev/null | sort); do \
		src=$$(echo "$$out" | sed 's|^$(MCP_PUB)/|$(MCP_SRC)/|; s|\.md$$|.src.md|'); \
		if [ ! -f "$$src" ]; then echo "ORPHAN: $$out has no source at $$src"; status=1; fi; \
	done; \
	[ $$status -eq 0 ] && echo "ok: no orphaned published files"; exit $$status

verify: orphans undiscoverable
	@before=$$($(MAKE) -s hash-generated); \
	$(MAKE) -s build >/dev/null || exit 1; \
	after=$$($(MAKE) -s hash-generated); \
	if [ "$$before" != "$$after" ]; then \
		echo "ERROR: published files are out of sync with their sources."; \
		echo "Run 'make build' and commit the result."; \
		git status --short -- $(CLI_PUB) $(MCP_PUB); \
		exit 1; \
	fi; \
	echo "ok: published files are in sync"

hash-generated:
	@find $(CLI_PUB) $(MCP_PUB) -name '*.md' 2>/dev/null | sort | xargs git hash-object

# Nothing in skill-src may be named SKILL.md, or it would be discovered as a
# skill and ship author-only notes to installs. No generated MCP document may
# be either, or a repository scanner would install it as a second copy of a
# CLI skill.
undiscoverable:
	@if find $(SRC_TREE) -name 'SKILL.md' -print | grep .; then \
		echo "ERROR: $(SRC_TREE) contains a literal SKILL.md (see above)."; \
		echo "Sources must use the .src.md suffix so skill installers ignore them."; \
		exit 1; \
	fi; \
	if find $(MCP_PUB) -name 'SKILL.md' -print 2>/dev/null | grep .; then \
		echo "ERROR: $(MCP_PUB) contains a literal SKILL.md (see above)."; \
		echo "MCP documents must be flat .md files so skill scanners ignore them."; \
		exit 1; \
	fi; \
	echo "ok: no SKILL.md inside $(SRC_TREE) or $(MCP_PUB)"

clean:
	rm -rf $(CLI_PUB) $(MCP_PUB)

install-tool:
	go install github.com/tgvashworth/litprompt@latest
