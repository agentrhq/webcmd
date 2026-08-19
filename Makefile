LITPROMPT ?= litprompt

# Layout: every source lives under skill-src/ and builds to the same relative
# path under skills/, with the .src.md suffix reduced to .md.
#
#   skill-src/webcmd-usage/SKILL.src.md
#     -> skills/webcmd-usage/SKILL.md
#   skill-src/webcmd-browser/references/browser-run-playwright.src.md
#     -> skills/webcmd-browser/references/browser-run-playwright.md
#
# Source files are never named SKILL.md. That is deliberate: skill installers
# (`npx skills add`, harness scanners) match the literal filename SKILL.md, so
# nothing in skill-src is ever discovered as a skill, and author-only notes
# cannot reach an installation. litprompt.yaml cannot express a cross-tree
# rename, so builds run per file.
#
# This Makefile is the skill pipeline only. TypeScript still builds with npm.

SRC_TREE := skill-src
PUB_TREE := skills
SOURCES  := $(shell find $(SRC_TREE) -name '*.src.md' 2>/dev/null | sort)

.PHONY: build check verify orphans install-tool clean hash-generated undiscoverable

build:
	@test -n "$(SOURCES)" || { echo "ERROR: no *.src.md sources found under $(SRC_TREE)"; exit 1; }
	@for src in $(SOURCES); do \
		out=$$(echo "$$src" | sed 's|^$(SRC_TREE)/|$(PUB_TREE)/|; s|\.src\.md$$|.md|'); \
		mkdir -p "$$(dirname "$$out")"; \
		$(LITPROMPT) build "$$src" -o "$$out" -q || exit 1; \
		echo "  $$src -> $$out"; \
	done
	@echo "ok: built $(words $(SOURCES)) file(s)"

# Imports resolve, no cycles, nothing written.
check:
	@$(LITPROMPT) check $(SRC_TREE) --match '**/*.src.md'

# Every published file must trace back to a source. Catches a skill deleted
# from the source tree but left behind in the installable one.
orphans:
	@status=0; \
	for out in $$(find $(PUB_TREE) -name '*.md' 2>/dev/null | sort); do \
		src=$$(echo "$$out" | sed 's|^$(PUB_TREE)/|$(SRC_TREE)/|; s|\.md$$|.src.md|'); \
		if [ ! -f "$$src" ]; then \
			echo "ORPHAN: $$out has no source at $$src"; status=1; \
		fi; \
	done; \
	[ $$status -eq 0 ] && echo "ok: no orphaned published files"; exit $$status

# Fail if anything published differs from a fresh build. Hashes before and
# after rather than reading git state, so it is honest whether or not the
# change is committed, and it catches a missing output too.
verify: orphans undiscoverable
	@before=$$($(MAKE) -s hash-generated); \
	$(MAKE) -s build >/dev/null || exit 1; \
	after=$$($(MAKE) -s hash-generated); \
	if [ "$$before" != "$$after" ]; then \
		echo "ERROR: published files are out of sync with their sources."; \
		echo "Run 'make build' and commit the result."; \
		git status --short -- $(PUB_TREE); \
		exit 1; \
	fi; \
	echo "ok: published files are in sync"

hash-generated:
	@find $(PUB_TREE) -name '*.md' 2>/dev/null | sort | xargs git hash-object

# Nothing in skill-src may be named SKILL.md, or it would be discovered as a
# skill and ship author-only notes to installs.
undiscoverable:
	@if find $(SRC_TREE) -name 'SKILL.md' -print | grep .; then \
		echo "ERROR: $(SRC_TREE) contains a literal SKILL.md (see above)."; \
		echo "Sources must use the .src.md suffix so skill installers ignore them."; \
		exit 1; \
	fi; \
	echo "ok: no SKILL.md inside $(SRC_TREE)"

install-tool:
	go install github.com/tgvashworth/litprompt@latest

# The published tree is entirely machine-owned, so this is safe.
clean:
	@rm -rf $(PUB_TREE)
	@echo "removed: $(PUB_TREE)"
