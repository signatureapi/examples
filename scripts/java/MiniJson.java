import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Tiny JSON reader so the examples need no dependency. Objects become Map, arrays List, numbers Long/Double. */
final class MiniJson {
  private final String s;
  private int i;

  private MiniJson(String s) {
    this.s = s;
  }

  static Object parse(String text) {
    MiniJson p = new MiniJson(text);
    Object v = p.value();
    p.ws();
    if (p.i != text.length()) throw new IllegalArgumentException("Trailing data");
    return v;
  }

  private void ws() {
    while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
  }

  private Object value() {
    ws();
    char c = s.charAt(i);
    if (c == '{') {
      i++;
      Map<String, Object> m = new LinkedHashMap<>();
      ws();
      if (s.charAt(i) == '}') {
        i++;
        return m;
      }
      while (true) {
        ws();
        String k = string();
        ws();
        i++; // ':'
        m.put(k, value());
        ws();
        if (s.charAt(i++) == '}') return m;
      }
    }
    if (c == '[') {
      i++;
      List<Object> l = new ArrayList<>();
      ws();
      if (s.charAt(i) == ']') {
        i++;
        return l;
      }
      while (true) {
        l.add(value());
        ws();
        if (s.charAt(i++) == ']') return l;
      }
    }
    if (c == '"') return string();
    if (s.startsWith("true", i)) {
      i += 4;
      return Boolean.TRUE;
    }
    if (s.startsWith("false", i)) {
      i += 5;
      return Boolean.FALSE;
    }
    if (s.startsWith("null", i)) {
      i += 4;
      return null;
    }
    int start = i;
    while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
    String n = s.substring(start, i);
    return n.matches("-?\\d+") ? (Object) Long.parseLong(n) : (Object) Double.parseDouble(n);
  }

  private String string() {
    StringBuilder b = new StringBuilder();
    i++; // opening quote
    while (true) {
      char c = s.charAt(i++);
      if (c == '"') return b.toString();
      if (c != '\\') {
        b.append(c);
        continue;
      }
      char e = s.charAt(i++);
      switch (e) {
        case 'n' -> b.append('\n');
        case 't' -> b.append('\t');
        case 'r' -> b.append('\r');
        case 'b' -> b.append('\b');
        case 'f' -> b.append('\f');
        case 'u' -> {
          b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
          i += 4;
        }
        default -> b.append(e); // \" \\ \/
      }
    }
  }
}
