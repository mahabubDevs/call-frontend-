import React, { useRef, useState, useEffect } from "react";
import { io } from "socket.io-client";

const socket = io("https://callbackend.thepigeonhub.com", { secure: true });

function App() {
  const [roomId, setRoomId] = useState("");
  const [callActive, setCallActive] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [bothConnected, setBothConnected] = useState(false);

  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const remoteAudioRef = useRef();
  const pc = useRef(
    new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    })
  );

  let otherUserId = useRef(null);
  let timerInterval = useRef(null);
  const MAX_CALL_DURATION = 300; // 5 minutes

  function getDummyVideoTrack() {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "gray";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.captureStream().getVideoTracks()[0];
  }

  useEffect(() => {
    if (!bothConnected) return;

    // Start media stream only after both connected
    navigator.mediaDevices
      .enumerateDevices()
      .then(async (devices) => {
        const hasCamera = devices.some((d) => d.kind === "videoinput");
        const constraints = hasCamera
          ? { video: true, audio: true }
          : { audio: true };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (!hasCamera) {
          const dummyTrack = getDummyVideoTrack();
          stream.addTrack(dummyTrack);
        }

        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        stream.getTracks().forEach((track) => pc.current.addTrack(track, stream));
      })
      .catch((err) => {
        console.error("Media device problem:", err);
        alert("Camera/microphone not found: " + err.message);
      });

    pc.current.ontrack = (event) => {
      const [stream] = event.streams;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
    };

    pc.current.onicecandidate = (event) => {
      if (event.candidate && otherUserId.current) {
        socket.emit("ice-candidate", {
          target: otherUserId.current,
          candidate: event.candidate,
        });
      }
    };

    // 🔹 Start timer
    setCallActive(true);
    timerInterval.current = setInterval(() => {
      setSecondsElapsed((prev) => {
        if (prev >= MAX_CALL_DURATION) {
          endCall();
          return prev;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(timerInterval.current);
  }, [bothConnected]);

  // socket events
  useEffect(() => {
    socket.on("other-user", (userId) => {
      otherUserId.current = userId;
      setBothConnected(true); // both connected -> start call
      pc.current
        .createOffer()
        .then((offer) => pc.current.setLocalDescription(offer))
        .then(() => {
          socket.emit("offer", {
            target: userId,
            sdp: pc.current.localDescription,
            caller: socket.id,
          });
        });
    });

    socket.on("user-joined", (userId) => {
      otherUserId.current = userId;
    });

    socket.on("offer", async (payload) => {
      await pc.current.setRemoteDescription(payload.sdp);
      const answer = await pc.current.createAnswer();
      await pc.current.setLocalDescription(answer);
      socket.emit("answer", { target: payload.caller, sdp: answer });
      setBothConnected(true);
    });

    socket.on("answer", async (payload) => {
      await pc.current.setRemoteDescription(payload.sdp);
      setBothConnected(true);
    });

    socket.on("ice-candidate", async (payload) => {
      try {
        await pc.current.addIceCandidate(payload.candidate);
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("call-ended", () => {
      alert("The other user ended the call.");
      endCall();
    });

    return () => {
      socket.off("other-user");
      socket.off("user-joined");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("call-ended");
    };
  }, []);

  const joinRoom = () => {
    if (!roomId) return;
    socket.emit("join-room", roomId);
  };

  const endCall = () => {
    setCallActive(false);
    setBothConnected(false);
    setSecondsElapsed(0);

    // stop local stream
    const localStream = localVideoRef.current?.srcObject;
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    const remoteStream = remoteVideoRef.current?.srcObject;
    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => track.stop());
    }

    pc.current.close();
    pc.current = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    otherUserId.current = null;
    clearInterval(timerInterval.current);

    socket.emit("call-ended"); // inform other user
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>🎥 2-User Video Call with Audio</h2>
      <input
        type="text"
        placeholder="Enter Room Code"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        disabled={callActive}
      />
      {!callActive ? (
        <button onClick={joinRoom} style={{ marginLeft: "10px" }}>
          Join Room
        </button>
      ) : (
        <button
          onClick={endCall}
          style={{ marginLeft: "10px", background: "red", color: "#fff" }}
        >
          Cancel Call
        </button>
      )}

      {callActive && bothConnected && (
        <p>Call Duration: {formatTime(secondsElapsed)}</p>
      )}

      <div style={{ display: "flex", marginTop: "20px" }}>
        <div style={{ textAlign: "center" }}>
          <p>🧍‍♂️ You</p>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: "300px", borderRadius: "8px" }}
          />
        </div>

        <div style={{ textAlign: "center", marginLeft: "20px" }}>
          <p>👤 Remote User</p>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{ width: "300px", borderRadius: "8px" }}
          />
          <audio ref={remoteAudioRef} autoPlay />
        </div>
      </div>
    </div>
  );
}

export default App;
