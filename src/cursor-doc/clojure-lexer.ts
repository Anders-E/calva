/**
 * Calva Clojure Lexer
 * 
 * NB: The lexer tokenizes any combination of clojure quotes, `~`, and `@` prepending a list, symbol, or a literal
 *     as one token, together with said list, symbol, or literal, even if there is whitespace between the quoting characters.
 *     All such combos won't actually be accepted by the Clojure Reader, but, hey, we're not writing a Clojure Reader here. 😀
 *     See below for the regex used for this.
 *     TODO: The newline as whitespace matching doesn't work. We only get one line at a time...
 *           Investigate!.
 */

 // Regex for the above mentioned behavior: /(['`~#@?]\s*)*/

import { LexicalGrammar, Token as LexerToken } from "./lexer"

/** The 'toplevel' lexical grammar. This grammar contains all normal tokens. Multi-line strings are identified as
 * "str-start", which trigger the lexer to switch to the 'multstring' lexical grammar.
 */
let toplevel = new LexicalGrammar()


/**
 * Returns `true` if open and close are compatible parentheses
 * @param open 
 * @param close 
 */
export function validPair(open: string, close: string): boolean {
    let valid = false;
    switch (close) {
        case ')':
            return open.endsWith("(");
        case ']':
            return open.endsWith("[");
        case '}':
            return open.endsWith("{");
        case '"':
            return open.endsWith('"');
        default:
            break;
    };
    return valid;
}

export interface Token extends LexerToken {
    state: ScannerState;
}

// whitespace, excluding newlines
toplevel.terminal(/[\t ,]+/, (l, m) => ({ type: "ws" }))
// newlines, we want each one as a token of its own
toplevel.terminal(/(\r?\n)/, (l, m) => ({ type: "ws" }))
// comments
toplevel.terminal(/;.*/, (l, m) => ({ type: "comment" }))
// open parens
//toplevel.terminal(/\(|\[|\{|@\(|['`]\(|#\(|#\?\(|#\{|#\?@\(/, (l, m) => ({ type: "open" }))
toplevel.terminal(/(['`~#@?]\s*)*[\(\[\{]/, (l, m) => ({ type: "open" }))
// close parens
toplevel.terminal(/\)|\]|\}/, (l, m) => ({ type: "close" }))

// punctuators
toplevel.terminal(/~@|~|'|#'|#:|#_|\^|`|#|\^:/, (l, m) => ({ type: "punc" }))

toplevel.terminal(/(['`~#@?]\s*)*(true|false|nil)/, (l, m) => ({ type: "lit" }))
toplevel.terminal(/(['`~#@?]\s*)*([0-9]+[rR][0-9a-zA-Z]+)/, (l, m) => ({ type: "lit" }))
toplevel.terminal(/(['`~#@?]\s*)*([-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?)/, (l, m) => ({ type: "lit" }))

toplevel.terminal(/(['`~#@?]\s*)*(:[^()[\]\{\}#,~@'`^\"\s;]*)/, (l, m) => ({ type: "kw" }))
// this is a REALLY lose symbol definition, but similar to how clojure really collects it. numbers/true/nil are all 
toplevel.terminal(/(['`~#@?^]\s*)*([^()[\]\{\}#,~@'`^\"\s:;][^()[\]\{\}#,~@'`^\"\s;]*)/, (l, m) => ({ type: "id" }))

// complete string on a single line
toplevel.terminal(/(['`~#@?]\s*)*(#?"([^"\\]|\\.)*")/, (l, m) => ({ type: "str" }))
toplevel.terminal(/(['`~#@?]\s*)*(#?"([^"\\]|\\.)*)/, (l, m) => ({ type: "str-start" }))
toplevel.terminal(/./, (l, m) => ({ type: "junk" }))

/** This is the multi-line string grammar. It spits out 'str-end' once it is time to switch back to the 'toplevel' grammar, and 'str-inside' if the string continues. */
let multstring = new LexicalGrammar()
// end a multiline string
multstring.terminal(/([^"\\]|\\.)*"/, (l, m) => ({ type: "str-end" }))
// still within a multiline string
multstring.terminal(/([^"\\]|\\.)+/, (l, m) => ({ type: "str-inside" }))

/**
 * The state of the scanner.
 * We only really need to know if we're inside a string or not.
 */
export interface ScannerState {
    /** Are we scanning inside a string? If so use multstring grammar, otherwise use toplevel. */
    inString: boolean
}

/**
 * A Clojure(Script) lexical analyser.
 * Takes a line of text and a start state, and returns an array of Token, updating its internal state.
 */
export class Scanner {
    state: ScannerState = { inString: false };

    processLine(line: string, state: ScannerState = this.state) {
        let tks: Token[] = [];
        this.state = state;
        let lex = (this.state.inString ? multstring : toplevel).lex(line);
        let tk: LexerToken;
        do {
            tk = lex.scan();
            if (tk) {
                let oldpos = lex.position;
                switch (tk.type) {
                    case "str-end": // multiline string ended, switch back to toplevel
                        this.state = { ...this.state, inString: false };
                        lex = toplevel.lex(line);
                        lex.position = oldpos;
                        break;
                    case "str-start": // multiline string started, switch to multstring.
                        this.state = { ...this.state, inString: true };
                        lex = multstring.lex(line);
                        lex.position = oldpos;
                        break;
                }
                tks.push({ ...tk, state: this.state });
            }
        } while (tk);
        // insert a sentinel EOL value, this allows us to simplify TokenCaret's implementation.
        tks.push({ type: "eol", raw: "\n", offset: line.length, state: this.state })
        return tks;
    }
}