# Third-Party Licenses

Frank is distributed under the PolyForm Shield License 1.0.0 (see `LICENSE`).
Frank also bundles or depends on the following third-party software, each
distributed under its own permissive license. The MIT, 0BSD, and Apache-2.0
terms require that their copyright notices and license texts be preserved in
redistributions — this file exists to satisfy that obligation.

---

## Konva (MIT)

Konva is loaded at runtime via `<script>` tag from unpkg. Homepage:
<https://konvajs.org/>.

```
The MIT License (MIT)

Copyright (C) 2011 - 2021 by Anton Lavrenov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## jsPDF (MIT)

jsPDF is loaded at runtime via `<script>` tag from unpkg, on demand when the
canvas PDF export is invoked. Homepage: <https://github.com/parallax/jsPDF>.

```
Copyright (c) 2010-2020 James Hall, https://github.com/MrRio/jsPDF
Copyright (c) 2015-2020 yWorks GmbH, https://www.yworks.com/

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## svg2pdf.js (MIT)

svg2pdf.js is loaded at runtime via `<script>` tag from unpkg, on demand when
the canvas PDF export is invoked. Homepage: <https://github.com/yWorks/svg2pdf.js>.

```
Copyright (c) 2015-2022 yWorks GmbH, https://www.yworks.com/

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## @anthropic-ai/sdk (MIT)

Daemon-side dependency. Used to call the Claude API on the user's behalf.
Homepage: <https://github.com/anthropics/anthropic-sdk-typescript>.

```
Copyright 2023 Anthropic, PBC.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ws (MIT)

Daemon-side dependency. Implements the WebSocket server the UI talks to.
Homepage: <https://github.com/websockets/ws>.

```
Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>
Copyright (c) 2013 Arnout Kazemier and contributors
Copyright (c) 2016 Luigi Pinca and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## pdfmake (MIT)

Daemon-side dependency. Used for the project-report PDF export. Ships the
Roboto font family (Apache-2.0) in `build/fonts/Roboto/`. Homepage:
<http://pdfmake.org/>.

```
The MIT License (MIT)

Copyright (c) 2014-2015 bpampuch
              2016-2026 liborm85

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### Roboto fonts (Apache-2.0, bundled inside pdfmake)

pdfmake bundles the Roboto font files used as its default typeface. Roboto
is distributed under the Apache License 2.0. The full license text is
available at <https://www.apache.org/licenses/LICENSE-2.0>. Copyright notice:

```
Copyright Google LLC. Roboto is distributed under the Apache License,
Version 2.0.
```

## tslib (0BSD)

Transitive dependency of pdfmake's underlying PDFKit / fontkit chain.
Homepage: <https://github.com/microsoft/tslib>.

```
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

## @vercel/blob (Apache-2.0) — Frank Cloud only

Used only in the self-hosted `frank-cloud/` Vercel deployment. Not bundled
into the Frank daemon or UI. Homepage: <https://github.com/vercel/storage>.

Distributed under the Apache License 2.0. Full license text at
<https://www.apache.org/licenses/LICENSE-2.0>.

```
Copyright Vercel Inc. Licensed under the Apache License, Version 2.0.
```

---

## Dev-only dependencies

The following packages are used during development/testing only and are not
bundled into the distributed artifact. They are listed for completeness:

- [Vitest](https://vitest.dev/) — MIT
- [TypeScript](https://www.typescriptlang.org/) — Apache-2.0
- [tsx](https://github.com/privatenumber/tsx) — MIT
- [@types/*](https://github.com/DefinitelyTyped/DefinitelyTyped) — MIT

---

## How to regenerate this file

When updating dependencies, re-collect notices with:

```bash
cd daemon && for pkg in $(ls node_modules); do
  for f in LICENSE LICENSE.md LICENSE.txt license license.md; do
    [ -f "node_modules/$pkg/$f" ] && echo "=== $pkg ===" && cat "node_modules/$pkg/$f" && echo
  done
done
```

Only top-level runtime deps need individual entries here; transitive deps
inherit the obligations of their parents.
