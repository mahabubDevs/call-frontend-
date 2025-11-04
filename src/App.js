import React, { useRef, useState, useEffect } from "react";
import { io } from "socket.io-client";

// 🔹 Socket.io signaling server
const socket = io("https://callbackend.thepigeonhub.com", { secure: true });

function App() {
  const [roomId, setRoomId] = useState("");
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const remoteAudioRef = useRef();

  // 🔹 Peer connection with STUN + TURN
  const pc = useRef(
    new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" }, // STUN
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp", // TURN server
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    })
  );

  let otherUserId = useRef(null);

  // 🔹 Dummy video (যদি camera না থাকে)
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
    // 🔹 Camera check + local stream
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

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        stream.getTracks().forEach((track) => pc.current.addTrack(track, stream));
      })
      .catch((err) => {
        console.error("Media device problem:", err);
        alert("Camera/microphone not found: " + err.message);
      });

    // 🔹 Remote stream handle
    pc.current.ontrack = (event) => {
      const [stream] = event.streams;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current
          .play()
          .catch(() =>
            console.warn("Autoplay blocked — user interaction required.")
          );
      }
    };

    // 🔹 ICE candidates send
    pc.current.onicecandidate = (event) => {
      if (event.candidate && otherUserId.current) {
        socket.emit("ice-candidate", {
          target: otherUserId.current,
          candidate: event.candidate,
        });
      }
    };

    // 🔹 Signaling events
    socket.on("other-user", (userId) => {
      otherUserId.current = userId;
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
    });

    socket.on("answer", async (payload) => {
      await pc.current.setRemoteDescription(payload.sdp);
    });

    socket.on("ice-candidate", async (payload) => {
      try {
        await pc.current.addIceCandidate(payload.candidate);
      } catch (e) {
        console.error(e);
      }
    });
  }, []);

  const joinRoom = () => {
    if (roomId !== "") socket.emit("join-room", roomId);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>🎥 2-User Video Call with Audio (STUN + TURN)</h2>
      <input
        type="text"
        placeholder="Enter Room Code"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
      />
      <button onClick={joinRoom} style={{ marginLeft: "10px" }}>
        Join Room
      </button>

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
