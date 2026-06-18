/**
 * Shell Completion Command
 * Generates bash completion script
 */

export interface CompletionOptions {
    shell?: string; // Only 'bash' is supported, kept for backward compatibility
}

export async function completionCommand(options: CompletionOptions): Promise<void> {
    // Validate shell option if provided (backward compatibility)
    if (options.shell && options.shell !== 'bash') {
        throw new Error(`Unsupported shell: ${options.shell}. Only bash is supported.`);
    }
    console.log(generateBashCompletion());
}

function generateBashCompletion(): string {
    return `#!/usr/bin/env bash
# Linting Orchestrator CLI bash completion script
# Source this file or add to ~/.bashrc:
#   eval "$(spectify completion)"

_spectify_completion() {
    local cur prev cmd sub
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    cmd="\${COMP_WORDS[1]}"
    sub="\${COMP_WORDS[2]}"

    # Top-level commands
    local commands="lint status results reproduce jobs history rulesets health config completion help --agents --help --version"

    case "\${COMP_CWORD}" in
        1)
            COMPREPLY=( \$(compgen -W "\${commands}" -- \${cur}) )
            return 0
            ;;
        2)
            case "\${cmd}" in
                lint)
                    if [[ \${cur} == -* ]]; then
                        COMPREPLY=( \$(compgen -W "-r --ruleset -v --version --override --no-cache --show-all --poll-interval" -- \${cur}) )
                    else
                        COMPREPLY=( \$(compgen -f -- \${cur}) )
                    fi
                    return 0
                    ;;
                status)
                    if [[ \${cur} == -* ]]; then
                        COMPREPLY=( \$(compgen -W "-w --watch" -- \${cur}) )
                    fi
                    return 0
                    ;;
                results)
                    if [[ \${cur} == -* ]]; then
                        COMPREPLY=( \$(compgen -W "--rule --severity --format --output --json" -- \${cur}) )
                    fi
                    return 0
                    ;;
                reproduce)
                    if [[ \${cur} == -* ]]; then
                        COMPREPLY=( \$(compgen -W "-o --output" -- \${cur}) )
                    fi
                    return 0
                    ;;
                jobs)
                    if [[ \${cur} == -* ]]; then
                        COMPREPLY=( \$(compgen -W "--status --ruleset -l --limit --detailed --json" -- \${cur}) )
                    fi
                    return 0
                    ;;
                history)
                    if [[ \${cur} == -* ]]; then
                        COMPREPLY=( \$(compgen -W "-l --limit -f --file --ruleset --clear" -- \${cur}) )
                    fi
                    return 0
                    ;;
                rulesets)
                    COMPREPLY=( \$(compgen -W "view check" -- \${cur}) )
                    return 0
                    ;;
                health)
                    if [[ \${cur} == -* ]]; then
                        COMPREPLY=( \$(compgen -W "--format" -- \${cur}) )
                    fi
                    return 0
                    ;;
                config)
                    COMPREPLY=( \$(compgen -W "show set reset" -- \${cur}) )
                    return 0
                    ;;
                help)
                    COMPREPLY=( \$(compgen -W "lint status results reproduce jobs history rulesets health config completion" -- \${cur}) )
                    return 0
                    ;;
            esac
            ;;
        3)
            # Third word: rulesets subcommand options and config set keys
            case "\${cmd}" in
                rulesets)
                    case "\${sub}" in
                        view)
                            if [[ \${cur} == -* ]]; then
                                COMPREPLY=( \$(compgen -W "--name --version --format" -- \${cur}) )
                            fi
                            return 0
                            ;;
                        check)
                            if [[ \${cur} == -* ]]; then
                                COMPREPLY=( \$(compgen -W "--name --version -r --rulesets-directory --format" -- \${cur}) )
                            fi
                            return 0
                            ;;
                    esac
                    ;;
                config)
                    case "\${sub}" in
                        set)
                            COMPREPLY=( \$(compgen -W "mode port.standalone port.companion url" -- \${cur}) )
                            return 0
                            ;;
                    esac
                    ;;
            esac
            ;;
    esac

    # Argument-value completions — triggered regardless of depth
    case "\${prev}" in
        -r|--ruleset)
            # Try to get live ruleset names from the running server; fall back to empty
            local rulesets
            rulesets=\$(spectify rulesets --format json 2>/dev/null | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | tr '\\n' ' ') || true
            COMPREPLY=( \$(compgen -W "\${rulesets}" -- \${cur}) )
            return 0
            ;;
        --format)
            # Infer valid values from the active command
            case "\${cmd}" in
                results)
                    COMPREPLY=( \$(compgen -W "table json sarif" -- \${cur}) )
                    ;;
                health|status)
                    COMPREPLY=( \$(compgen -W "text json" -- \${cur}) )
                    ;;
                rulesets)
                    case "\${sub}" in
                        check) COMPREPLY=( \$(compgen -W "text json" -- \${cur}) ) ;;
                        *)     COMPREPLY=( \$(compgen -W "table json" -- \${cur}) ) ;;
                    esac
                    ;;
                *)
                    COMPREPLY=( \$(compgen -W "table json text sarif" -- \${cur}) )
                    ;;
            esac
            return 0
            ;;
        --severity)
            COMPREPLY=( \$(compgen -W "error warning info hint" -- \${cur}) )
            return 0
            ;;
        --status)
            COMPREPLY=( \$(compgen -W "completed completed_with_errors failed running timeout queued" -- \${cur}) )
            return 0
            ;;
        mode)
            COMPREPLY=( \$(compgen -W "standalone embedded companion" -- \${cur}) )
            return 0
            ;;
    esac
}

complete -F _spectify_completion spectify

# Support for common aliases
# If you use an alias like 'spy', add: complete -F _spectify_completion spy
complete -F _spectify_completion spy 2>/dev/null || true
`;
}
