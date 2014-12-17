{
    var result;
}

start = ({
    result = {require: {}, provide: {}, provideGoog: false};
}) (oneline / comment / string / useful / anychar)* {
    return result;
}

oneline = "//" [^\n]* "\n"

comment = "/*" ("@provideGoog" {
    result.provideGoog = true;
} / !"*/" [^])* "*/"

string = "'" a:(a:"\\" b:[^] { return a + b; } / [^'])* "'" {
    return a.join("");
} / '"' a:(a:"\\" b:[^] { return a + b; } / [^"])* '"' {
    return a.join("");
}

useful = "goog" sp0 "." sp0 t:("require" / "provide") sp0
    "(" sp0 u:string sp0 ")" sp0 ";"
    { result[t][u] = true; }

anychar = [^]

sp0 = " \t"*