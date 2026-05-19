import { useRef, useState } from 'react';

/** AUDIO_RECORDING — MediaRecorder API */
export default function AudioRecordingQuestion({ question, audioUrl, onChange }) {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState(audioUrl ? 'Audio guardado' : 'Listo para grabar');
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const toggle = async () => {
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          onChange(reader.result);
          setStatus('Audio guardado');
          setRecording(false);
          stopTracks();
        };
        reader.readAsDataURL(blob);
      };
      rec.start();
      setRecording(true);
      setStatus('● Grabando…');
    } catch (err) {
      setStatus('Micrófono no disponible');
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6 rounded-xl border border-dashed border-white/20 bg-black/20">
      <p className="text-violet-200 text-sm font-medium">{status}</p>
      <button
        type="button"
        onClick={toggle}
        className={`px-5 py-3 rounded-xl font-bold text-white ${
          recording ? 'bg-red-600' : 'bg-violet-600'
        }`}
      >
        {recording ? '⏹ Detener y guardar' : '🎤 Iniciar grabación'}
      </button>
    </div>
  );
}
