# Spoken Word Triggers

Someone says a word in a voice channel; Lyra replies in chat, says something back out loud, or
plays a clip into the channel. The spoken counterpart of `/keyword`, built on the voice
assistant's existing listener → VAD → Whisper pipeline.

## How it differs from chat word triggers

|               | `/keyword` (chat)         | `/voicekeyword` (spoken)              |
| ------------- | ------------------------- | ------------------------------------- |
| Input         | `messageCreate`           | Transcribed voice                     |
| Table         | `word_triggers`           | `voice_word_triggers`                 |
| Matching      | substring (`LIKE '%kw%'`) | whole word / consecutive phrase       |
| Response      | text                      | text, spoken aloud, or a sound clip   |
| Rate limiting | none                      | per-trigger cooldown, 30 s by default |

The two lists are deliberately separate. Turning spoken triggers on means everything said in
the channel is transcribed, so what is allowed to fire there deserves its own short, audited
list rather than inheriting every meme that has accumulated in chat.

Matching is whole-word rather than substring for the same reason: a transcript is generated
text with nobody to blame for a near miss, so `ass` matching inside `class` would be the common
case, not a funny edge case. Multi-word keywords match as a consecutive run of words.

## Setting it up

1. **Turn it on.** Dashboard → Config → Voice assistant → _Spoken word triggers_. Off by
   default, per guild.
2. **Add triggers.** Either surface works:
    - `/voicekeyword add keyword:<word> response:<text> [cooldown:<seconds>]`
    - `/voicekeyword add-speak keyword:<word> response:<text> [cooldown:<seconds>]`
    - `/voicekeyword add-sound keyword:<word> clip:<attachment> [name:<clip name>] [cooldown:<seconds>]`
    - Dashboard → Config → Spoken word triggers (all three, with sound triggers pointing at an
      already-uploaded clip)
3. **Start listening.** `/assistant on` from a voice channel. Triggers are inert until a
   session is running — `/voicekeyword list` says which of the two steps is missing.

Other subcommands: `/voicekeyword delete`, `list`, `sounds`, `delete-sound`.

## Spoken responses

`add-speak` (dashboard: _Say it out loud_) sends the response through the Piper sidecar and
plays it back into the channel, so the bot answers where it was spoken to rather than in a text
channel nobody is looking at.

- Capped at **240 characters**, the same cap `toSpeech` applies before synthesis. An over-long
  response is rejected at both surfaces rather than truncated: a trigger that says two thirds of
  what it was given is worse than one that refused it.
- Discord message chrome is stripped before speaking — markdown, emoji, mentions — so a response
  written for chat does not come out as "asterisk asterisk".
- It shares the clip player, so a spoken response is **dropped, not queued**, while a clip is
  playing, and vice versa.
- No fallback to a text reply if the sidecar is down. `text` is a response type someone can pick
  deliberately, so quietly becoming it would misrepresent what was configured; a dead sidecar
  shows up as a trigger that did not dispatch, the same as a missing clip does. An unreachable
  sidecar is reported by `/assistant status`.

## Sound clips

Clips are uploaded as Discord attachments and stored per guild under `data/voice_sounds/`
(override with `VOICE_SOUNDS_DIR`). Names are sanitised down to `[a-z0-9-]`, so nothing a user
types reaches the filesystem verbatim.

- Max 2 MB and 50 clips per guild; playback is cut at 10 seconds.
- Accepted containers: mp3, ogg, oga, opus, wav, webm, m4a, mp4, flac, aac.
- Deleting a clip leaves the triggers pointing at it in place, and says which they are —
  re-uploading under the same name repairs them.

Playback goes through the **listener** client's own voice connection, not Lavalink. A trigger
clip is an interjection, not a queue entry: routing it through the music player would mean
stopping the current track, playing the clip and restoring position. Because the listener holds
a separate voice connection, a clip mixes in over whatever is playing instead of interrupting
it. This is why the listener now joins unmuted.

## How detection works

The detection worker gains two modes beyond the original wake-word one:

- **`wake`** — capture starts at a wake-word hit. Nothing else is transcribed. This is what
  runs when spoken triggers are off, unchanged.
- **`both`** — what runs when they are on. Capture starts at _speech onset_, so everything said
  is transcribed, and the wake model keeps scoring in parallel.
- **`scan`** — speech onset only, wake model not run at all. Not currently selected by config;
  it exists because it is the cheaper half of `both`.

In `both` mode, a wake-word hit part-way through an utterance closes the current capture (emitted
as overheard speech, for trigger scanning) and opens a fresh one at the wake word. That keeps
the intent grammar seeing a transcript that starts with the verb, as it does in `wake` mode.

**Intent dispatch stays behind the wake word.** Only utterances flagged `wake` are parsed as
commands. Someone saying "stop" mid-conversation must not stop the music.

Overheard captures are additionally gated on **voiced** frames, not just duration: a capture
always carries 320 ms of pre-roll and runs through the silence timeout, so a single-frame cough
clears the 250 ms floor easily. Without the voiced-frame gate every door slam in the channel
would be an STT round trip.

## Privacy

Spoken triggers transcribe everything said in the channel, which is a materially bigger ask
than matching one wake phrase on-device. Accordingly:

- It is **off by default** and per guild.
- The join announcement says so explicitly when it is on, in plainer words than the wake-word
  case gets.
- `/assistant status` and the dashboard both show the current state; the dashboard warns while
  it is enabled.
- `/assistant optout` still means the user's stream is never subscribed to at all — not
  subscribed and ignored.
- **Overheard transcripts are never stored or logged at info level.** Only the keyword that
  fired goes to `voice_command_log`. The wake-word path logs full transcripts because there the
  user addressed the bot deliberately; that reasoning does not extend to conversation.
- Trigger replies resolve only the speaker's own mention, so a transcription error cannot ping
  a role or `@everyone`.

## Cost

Every utterance in the channel becomes a Whisper request while this is on, against one request
per wake word before. The existing per-user in-flight guard drops a new utterance while that
user's previous one is still being transcribed, which bounds the load at roughly one concurrent
request per speaker.

## Configuration reference

| Setting              | Where                             | Default               |
| -------------------- | --------------------------------- | --------------------- |
| `triggers_enabled`   | `voice_assistant_config`          | `0`                   |
| Per-trigger cooldown | `voice_word_triggers.cooldown_ms` | 30 000 ms (1 s – 1 h) |
| Clip directory       | `VOICE_SOUNDS_DIR`                | `./data/voice_sounds` |
| Max clip size        | `MAX_SOUND_BYTES`                 | 2 MB                  |
| Max clips per guild  | `MAX_SOUNDS_PER_GUILD`            | 50                    |
| Playback cap         | `MAX_PLAYBACK_MS`                 | 10 s                  |
| Spoken response cap  | `MAX_SPOKEN_CHARS`                | 240 characters        |
| TTS sidecar          | `TTS_URL`                         | `http://tts:8000`     |

Changes made through either surface are written to the config audit log under the
`voice_triggers` section.
