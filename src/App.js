import React, { useRef, useState, useEffect } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:5004");

function App() {
  const [roomId, setRoomId] = useState("");
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const remoteAudioRef = useRef();
  const pc = useRef(
    new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
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
    // 🔹 Camera আছে কিনা check
    navigator.mediaDevices
      .enumerateDevices()
      .then(async (devices) => {
        const hasCamera = devices.some((d) => d.kind === "videoinput");
        const constraints = hasCamera
          ? { video: true, audio: true }
          : { audio: true };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        // যদি video না থাকে, dummy video add করো
        if (!hasCamera) {
          const dummyTrack = getDummyVideoTrack();
          stream.addTrack(dummyTrack);
        }

        // local preview
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // add tracks to connection
        stream.getTracks().forEach((track) => pc.current.addTrack(track, stream));
      })
      .catch((err) => {
        console.error("Media device problem:", err);
        alert("Camera/microphone not found: " + err.message);
      });

    // 🔹 যখন অন্য ইউজারের ভিডিও/অডিও আসে
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

    // 🔹 ICE candidate পাঠানো
    pc.current.onicecandidate = (event) => {
      if (event.candidate && otherUserId.current) {
        socket.emit("ice-candidate", {
          target: otherUserId.current,
          candidate: event.candidate,
        });
      }
    };

    // 🔹 অন্য ইউজার রুমে থাকলে
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

    // 🔹 নতুন ইউজার join করলে
    socket.on("user-joined", (userId) => {
      otherUserId.current = userId;
    });

    // 🔹 Offer handle
    socket.on("offer", async (payload) => {
      await pc.current.setRemoteDescription(payload.sdp);
      const answer = await pc.current.createAnswer();
      await pc.current.setLocalDescription(answer);
      socket.emit("answer", { target: payload.caller, sdp: answer });
    });

    // 🔹 Answer handle
    socket.on("answer", async (payload) => {
      await pc.current.setRemoteDescription(payload.sdp);
    });

    // 🔹 ICE candidate handle
    socket.on("ice-candidate", async (payload) => {
      try {
        await pc.current.addIceCandidate(payload.candidate);
      } catch (e) {
        console.error(e);
      }
    });
  }, []);

  // 🔹 Room join button
  const joinRoom = () => {
    if (roomId !== "") socket.emit("join-room", roomId);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>🎥 2-User Video Call with Audio</h2>
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
