/** Limits the server enforces; the dashboard imports this module directly, so it must stay dependency-free. */
export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 300;
export const MAX_COVER_BYTES = 1024 * 1024;
export const MAX_REPEAT = 10;
/** Per audio file, for /play-file, /playlist add-file and dashboard uploads alike. */
export const MAX_AUDIO_UPLOAD_BYTES = 100 * 1024 * 1024;
/** What the dashboard's file picker offers; the server still checks extension and content. */
export const AUDIO_UPLOAD_ACCEPT = '.mp3,.m4a,.m4b,.aac,.flac,.wav,.ogg,.oga,.opus,.webm,.mka';
