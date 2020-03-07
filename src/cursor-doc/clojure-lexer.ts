/**
 * Calva Clojure Lexer
 *
 * NB: The lexer tokenizes any combination of clojure quotes, `~`, and `@` prepending a list, symbol, or a literal
 *     as one token, together with said list, symbol, or literal, even if there is whitespace between the quoting characters.
 *     All such combos won't actually be accepted by the Clojure Reader, but, hey, we're not writing a Clojure Reader here. 😀
 *     See below for the regex used for this.
 */

// prefixing patterns - TODO: revisit these and see if we can always use the same
// opens ((?<!\p{Ll})['`~#@?^]\s*)*
// id    (['`~#^@]\s*)*
// lit   (['`~#]\s*)*
// kw    (['`~^]\s*)*

import { LexicalGrammar, Token as LexerToken } from "./lexer"

/**
 * The 'toplevel' lexical grammar. This grammar contains all normal tokens. Strings are identified as
 * "open", and trigger the lexer to switch to the 'inString' lexical grammar.
 */
let toplevel = new LexicalGrammar()


/**
 * Returns `true` if open and close are compatible parentheses
 * @param open
 * @param close
 */
export function validPair(open: string, close: string): boolean {
    const openBracket = open[open.length - 1];
    switch (close) {
        case ')':
            return openBracket === '(';
        case ']':
            return openBracket === '[';
        case '}':
            return openBracket === '{';
        case '"':
            return openBracket === '"';
    };
    return false;
}

export interface Token extends LexerToken {
    state: ScannerState;
}

// whitespace, excluding newlines
toplevel.terminal(/[\t ,]+/, (l, m) => ({ type: "ws" }))
// newlines, we want each one as a token of its own
toplevel.terminal(/(\r|\n|\r\n)/, (l, m) => ({ type: "ws" }))
// comments
toplevel.terminal(/;.*/, (l, m) => ({ type: "comment" }))

// current idea for prefixing data reader
// (#[^\(\)\[\]\{\}"_@~\s,]+[\s,]*)*

// open parens
toplevel.terminal(/(#[^\(\)\[\]\{\}"_@~\s,]+[\s,]*)*((?<=(^|[\(\)\[\]\{\}\s,]))['`~#@?^]\s*)*['`~#@?^]*[\(\[\{"]/, (l, m) => ({ type: "open" }))
// close parens
toplevel.terminal(/\)|\]|\}/, (l, m) => ({ type: "close" }))

// ignores
toplevel.terminal(/#_/, (l, m) => ({ type: "ignore" }))

// literals
toplevel.terminal(/(\\[^\(\)\[\]\{\}\s]+|\\[\(\)\[\]\{\}])/, (l, m) => ({ type: "lit" }))

// This seems unecessary?
//toplevel.terminal(/(['`~#]\s*)*\\\"/, (l, m) => ({ type: "lit" }))
toplevel.terminal(/(['`~#]\s*)*(true|false|nil)/, (l, m) => ({ type: "lit" }))
toplevel.terminal(/(['`~#]\s*)*([0-9]+[rR][0-9a-zA-Z]+)/, (l, m) => ({ type: "lit" }))
toplevel.terminal(/(['`~#]\s*)*([-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?)/, (l, m) => ({ type: "lit" }))

toplevel.terminal(/(#[^\(\)\[\]\{\}"_@~\s,]+[\s,]*)*(['`~^]\s*)*(:[^()[\]\{\},~@`^\"\s;]*)/, (l, m) => ({ type: "kw" }))

// data readers
toplevel.terminal(/#[^\(\)\[\]\{\}"_@~\s,]+/, (_l, _m) => ({ type: "reader" }));

// symbols, about anything goes!
toplevel.terminal(/(['`~#^@]\s*)*([^_()[\]\{\}#,~@'`^\"\s:;][^()[\]\{\},~@`\"\s;]*)/, (l, m) => ({ type: "id" }))


toplevel.terminal(/./, (l, m) => ({ type: "junk" }))

/** This is inside-string string grammar. It spits out 'close' once it is time to switch back to the 'toplevel' grammar,
 * and 'str-inside' for the words in the string. */
let inString = new LexicalGrammar()
// end a string
inString.terminal(/"/, (l, m) => ({ type: "close" }))
// still within a string
inString.terminal(/(\\.|[^\\"\t\r\n ])+/, (l, m) => ({ type: "str-inside" }))
// whitespace, excluding newlines
inString.terminal(/[\t ]+/, (l, m) => ({ type: "ws" }))
// newlines, we want each one as a token of its own
inString.terminal(/(\r?\n)/, (l, m) => ({ type: "ws" }))


/**
 * The state of the scanner.
 * We only really need to know if we're inside a string or not.
 */
export interface ScannerState {
    /** Are we scanning inside a string? If so use inString grammar, otherwise use toplevel. */
    inString: boolean,
    currentReaderToken: LexerToken
}

/**
 * A Clojure(Script) lexical analyser.
 * Takes a line of text and a start state, and returns an array of Token, updating its internal state.
 */
export class Scanner {
    state: ScannerState = {
        // TODO: These should never be both true
        inString: false,
        currentReaderToken: undefined
     };

    constructor(private maxLength: number) {}

    processLine(line: string, state: ScannerState = this.state) {
        let tks: Token[] = [];
        this.state = state;
        let lex = (this.state.inString ? inString : toplevel).lex(line, this.maxLength);
        let tk: LexerToken;
        do {
            tk = lex.scan();
            if (tk) {
                let oldpos = lex.position;
                if (tk.raw.match(/[~`'@#]*"$/)) {
                    switch (tk.type) {
                        case "open": // string started, switch to inString.
                            this.state = { ...this.state, inString: true };
                            lex = inString.lex(line, this.maxLength);
                            lex.position = oldpos;
                            break;
                        case "close":
                            // string ended, switch back to toplevel
                            this.state = { ...this.state, inString: false };
                            lex = toplevel.lex(line, this.maxLength);
                            lex.position = oldpos;
                            break;
                    }
                } else if (tk.type === 'reader') {
                    this.state.currentReaderToken = tk;
                    continue;
                } else if (this.state.currentReaderToken) {
                    if (['ws', 'comment'].includes(tk.type)) {
                        this.state.currentReaderToken.raw += tk.raw;
                        continue;
                    } else {
                        tk.offset = this.state.currentReaderToken.offset;
                        tk.raw = this.state.currentReaderToken.raw + '\n' + tk.raw;
                        this.state.currentReaderToken = undefined;
                    }
                }
                tks.push({ ...tk, state: this.state });
            }
        } while (tk);
        // insert a sentinel EOL value, this allows us to simplify TokenCaret's implementation.
        tks.push({ type: "eol", raw: "\n", offset: line.length, state: this.state })
        return tks;
    }
}