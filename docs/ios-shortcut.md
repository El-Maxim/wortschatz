# Adding words from the iOS share sheet

Android can share text straight into an installed PWA, but Safari does not support
Web Share Targets. The workaround on iPhone is an Apple Shortcut: it takes whatever
text you have selected and opens Wortschatz with the capture box already filled in.

Two taps from any app — Share → Add to Wortschatz — and the word is on screen ready
to save.

## Install the app first

1. Open **https://el-maxim.github.io/wortschatz/** in **Safari** (this must be Safari —
   Chrome on iOS cannot install PWAs)
2. Tap the **Share** button, then **Add to Home Screen**
3. Name it *Wortschatz* and tap **Add**

## Build the Shortcut

Open the **Shortcuts** app and tap **+** to create a new shortcut.

### 1. Let it receive text

- Tap the shortcut name at the top → **Details** (or the ⓘ button)
- Turn on **Show in Share Sheet**
- Under **Share Sheet Types**, deselect everything except **Text**
- Tap **Done**

### 2. Add the action

- Tap **Add Action** and search for **URL**
- Choose the **URL** action and paste exactly:

  ```
  https://el-maxim.github.io/wortschatz/?add=
  ```

- Search for **Text** and add a **Text** action below it. Leave it empty for now.
- Tap into the Text field, then tap the **Shortcut Input** variable from the suggestion
  bar above the keyboard (it may appear as *Shortcut Input* or *Provided Input*)
- Now search for **Combine Text** and add it. Set it to combine the **URL** and the
  **Text** with **Nothing** as the separator.
- Finally add **Open URLs** and make sure it takes the **Combined Text** as its input

The finished shortcut reads:

| Step | Action |
|---|---|
| 1 | URL — `https://el-maxim.github.io/wortschatz/?add=` |
| 2 | Text — `Shortcut Input` |
| 3 | Combine Text — URL and Text, separator: Nothing |
| 4 | Open URLs — Combined Text |

### 3. Name it

Rename the shortcut to **Add to Wortschatz** — this is the label you will tap in the
share sheet, so keep it short enough to read at a glance.

## Using it

1. Select a German word anywhere — Safari, Kindle, Mail, a PDF, a message
2. Tap **Share**
3. Scroll to **Add to Wortschatz**

Wortschatz opens with the word already in the capture box, the dictionary entry
resolved, and the article shown. Tap **Speichern**.

## If the word arrives with extra text

The app takes the first few words of whatever it receives, so sharing a whole sentence
still works — just trim the box to the single word before saving. Better still, paste
the sentence into **Where did you see it?**: a saved context sentence is what generates
your cloze and word-order exercises later.

## Simpler alternative

If you would rather not build a Shortcut, the URL works on its own. Bookmark:

```
https://el-maxim.github.io/wortschatz/?add=WORD
```

and edit the word by hand — or just open the app and tap **+**, which is only one tap
more and is how you will capture most words anyway.
