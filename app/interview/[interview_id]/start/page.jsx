"use client";

import { InterviewDataContext } from "@/context/InterviewDataContext";
import { Mic, Phone, Timer } from "lucide-react";
import Image from "next/image";
import React, { useContext, useEffect, useState, useRef } from "react";
import Vapi from "@vapi-ai/web";
import AlertConfirmation from "./_components/AlertConfirmation";
import axios from "axios";
import { FEEDBACK_PROMPT } from "@/services/Constants";
import TimmerComponent from "./_components/TimmerComponent";
import { getVapiClient } from "@/lib/vapiconfig";
import { supabase } from "@/services/supabaseClient";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

function StartInterview() {
  const { interviewInfo, setInterviewInfo } = useContext(InterviewDataContext);
  const vapi = getVapiClient();
  const [activeUser, setActiveUser] = useState(false);
  const [start, setStart] = useState(false);
  const [subtitles, setSubtitles] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const conversation = useRef(null);
  const { interview_id } = useParams();
  const router = useRouter();
  const [userProfile, setUserProfile] = useState({
    picture: null,
    name: interviewInfo?.candidate_name || "Candidate",
  });
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);

  useEffect(() => {
    if (!interviewInfo && typeof window !== "undefined") {
      const stored = localStorage.getItem("interviewInfo");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.interview_id === interview_id) {
            setInterviewInfo(parsed);
          } else {
            localStorage.removeItem("interviewInfo");
            router.replace(`/interview/${interview_id}`);
          }
        } catch {
          localStorage.removeItem("interviewInfo");
          router.replace(`/interview/${interview_id}`);
        }
      } else {
        router.replace(`/interview/${interview_id}`);
      }
    }
  }, [interviewInfo, interview_id, setInterviewInfo, router]);

  useEffect(() => {
    if (interviewInfo && interviewInfo?.jobPosition && vapi && !start) {
      setStart(true);
      startCall();
    }
  }, [interviewInfo, vapi]);

  const startCall = async () => {
    const jobPosition = interviewInfo?.jobPosition || "Unknown Position";
    const questionList =
      interviewInfo?.questionList?.interviewQuestions?.map(
        (question) => question?.question
      ) || [];

    const assistantOptions = {
      name: "AI Recruiter",
      firstMessage: `Hi ${interviewInfo?.candidate_name}, how are you? Ready for your interview on ${interviewInfo?.jobPosition}?`,
      transcriber: {
        provider: "deepgram",
        model: "nova-3",
        language: "en-US",
      },
      voice: {
        provider: "playht",
        voiceId: "jennifer",
      },
      model: {
        provider: "openai",
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `
You are an AI voice assistant conducting interviews.
Ask one question at a time and wait for the candidate's response before proceeding.
Keep the questions clear, concise, and friendly.
After completing all questions, wrap up with encouraging feedback.
Questions: ${questionList}
`.trim(),
          },
        ],
      },
    };

    if (!vapi) {
      toast.error("Vapi client not initialized!");
      return;
    }
    if (!interviewInfo) {
      toast.error("Interview info missing, aborting call startup.");
      return;
    }

    try {
      vapi.start(assistantOptions);
    } catch (error) {
      console.error("Error starting Vapi:", error);
      toast.error("Failed to start AI interview. See console for details.");
    }
  };

  useEffect(() => {
    if (!vapi) return;

    const handleMessage = (message) => {
      if (message?.role === "assistant" && message?.content) {
        setSubtitles(message.content);
      }
      if (message && message?.conversation) {
        const filteredConversation =
          message.conversation.filter((msg) => msg.role !== "system") || "";
        const conversationString = JSON.stringify(filteredConversation, null, 2);
        conversation.current = conversationString;
      }
    };

    const handleSpeechStart = () => {
      setIsSpeaking(true);
      setActiveUser(false);
      toast("AI is speaking...");
    };

    const handleSpeechEnd = () => {
      setIsSpeaking(false);
      setActiveUser(true);
    };

    vapi.on("message", handleMessage);
    vapi.on("call-start", () => {
      toast("Call started...");
      setStart(true);
    });
    vapi.on("speech-start", handleSpeechStart);
    vapi.on("speech-end", handleSpeechEnd);
    vapi.on("call-end", async () => {
      toast("Call has ended. Generating feedback...");
      setIsGeneratingFeedback(true);
      await handleFeedbackGeneration();
    });

    return () => {
      vapi.off("message", handleMessage);
      vapi.off("call-start", () => {});
      vapi.off("speech-start", handleSpeechStart);
      vapi.off("speech-end", handleSpeechEnd);
      vapi.off("call-end", () => {});
    };
  }, [vapi]);

  // ✅ FIXED FUNCTION — handles full feedback generation
  const handleFeedbackGeneration = async () => {
    try {
      console.log("🧠 Generating feedback for transcript...");

      const transcript = conversation.current || "";
      const jobRole = interviewInfo?.jobPosition;
      const jobDescription = interviewInfo?.jobDescription;

      const result = await axios.post("/api/ai-feedback", {
        transcript,
        jobRole,
        jobDescription,
      });

      // Step 1: Extract
      let Content = result?.data?.content || result?.data?.Content;
      if (!Content || typeof Content !== "string") {
        console.error("❌ Feedback API did not return valid content:", result.data);
        throw new Error("Feedback content missing or invalid");
      }

      console.log("🧩 Raw Feedback Content:", JSON.stringify(Content, null, 2));

      // Step 2: Clean
      Content = Content.replace(/^<s>\s*/gi, "")
        .replace(/<\/s>$/gi, "")
        .replace(/```json\s*/gi, "")
        .replace(/```/g, "")
        .trim();

      console.log("🧩 Cleaned AI Feedback Content:", Content);

      // Step 3: Parse
      let parsedTranscript;
      try {
        parsedTranscript = JSON.parse(Content);
      } catch (e) {
        console.error("❌ Failed to parse feedback JSON:", Content);
        throw new Error("Could not parse AI feedback JSON");
      }

      // Step 4: Insert into Supabase
      const { error: insertError } = await supabase.from("interview_results").insert([
        {
          fullname: interviewInfo?.candidate_name,
          email: interviewInfo?.userEmail,
          interview_id: interview_id,
          conversation_transcript: parsedTranscript,
          recommendations: "Not recommended",
          completed_at: new Date().toISOString(),
        },
      ]);

      if (insertError) {
        console.error("Supabase insert error:", insertError);
        throw new Error("Insert failed");
      }

      toast.success("Feedback generated successfully!");
      if (typeof window !== "undefined") {
        localStorage.removeItem("interviewInfo");
      }

      router.replace(`/interview/${interviewInfo?.interview_id}/completed`);
    } catch (error) {
      console.error("Feedback generation failed:", error);
      toast.error("Failed to generate feedback");
    } finally {
      setIsGeneratingFeedback(false);
    }
  };

  const stopInterview = () => {
    vapi.stop();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* HEADER */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {interviewInfo?.jobPosition || "AI"} Interview Session
            </h1>
            <p className="text-gray-600">Powered by AI Interview Assistant</p>
          </div>
          <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
            <Timer className="text-blue-600" />
            <span className="font-mono text-lg font-semibold text-gray-700">
              <TimmerComponent start={start} />
            </span>
          </div>
        </header>

        {/* AVATARS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* AI */}
          <div
            className={`bg-white rounded-xl p-6 shadow-md border transition-all duration-300 ${
              isSpeaking
                ? "border-blue-300 ring-2 ring-blue-100"
                : "border-gray-200"
            }`}
          >
            <div className="flex flex-col items-center justify-center h-full space-y-4">
              <div className="relative">
                {isSpeaking && (
                  <div className="absolute inset-0 rounded-full bg-blue-100 animate-ping opacity-75"></div>
                )}
                <div className="relative z-10 w-20 h-20 rounded-full overflow-hidden border-4 border-white shadow-md bg-blue-100">
                  <Image
                    src="/AIR.png"
                    alt="AI Recruiter"
                    width={80}
                    height={80}
                    className="object-cover w-full h-full"
                    priority
                  />
                </div>
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-gray-800">AI Recruiter</h2>
                <p className="text-sm text-gray-500">Interview HR</p>
              </div>
            </div>
          </div>

          {/* Candidate */}
          <div
            className={`bg-white rounded-xl p-6 shadow-md border transition-all duration-300 ${
              activeUser
                ? "border-purple-300 ring-2 ring-purple-100"
                : "border-gray-200"
            }`}
          >
            <div className="flex flex-col items-center justify-center h-full space-y-4">
              <div className="relative">
                {activeUser && (
                  <div className="absolute inset-0 rounded-full bg-purple-100 animate-ping opacity-75"></div>
                )}
                <div className="relative z-10 w-20 h-20 rounded-full overflow-hidden border-4 border-white shadow-md bg-gray-100 flex items-center justify-center">
                  {userProfile.picture ? (
                    <Image
                      src={userProfile.picture}
                      alt={userProfile.name}
                      width={80}
                      height={80}
                      className="object-cover"
                      priority
                    />
                  ) : (
                    <span className="text-2xl font-bold text-gray-600">
                      {userProfile.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-gray-800">
                  {userProfile.name}
                </h2>
                <p className="text-sm text-gray-500">Candidate</p>
              </div>
            </div>
          </div>
        </div>

        {/* SUBTITLES */}
        <div className="bg-white rounded-lg p-4 mb-6 shadow-sm border border-gray-200">
          <div className="min-h-16 flex items-center justify-center">
            {subtitles ? (
              <p className="text-center text-gray-700 animate-fadeIn">
                "{subtitles}"
              </p>
            ) : (
              <p className="text-center text-gray-400">
                {isSpeaking ? "AI is speaking..." : "Waiting for response..."}
              </p>
            )}
          </div>
        </div>

        {/* CONTROLS */}
        <div className="bg-white rounded-xl p-4 shadow-md border border-gray-200">
          <div className="flex flex-col items-center">
            <div className="flex gap-4 mb-4">
              <AlertConfirmation stopInterview={stopInterview}>
                <button
                  className="p-3 rounded-full bg-red-100 text-red-600 hover:bg-red-200 shadow-sm transition-all flex items-center gap-2"
                  aria-label="End call"
                >
                  <Phone size={20} />
                  <span>End Interview</span>
                </button>
              </AlertConfirmation>
            </div>
            <p className="text-sm text-gray-500">
              {activeUser ? "Please respond..." : "AI is speaking..."}
            </p>
          </div>
        </div>
      </div>

      {/* FEEDBACK LOADER */}
      {isGeneratingFeedback && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">
              Generating Feedback
            </h2>
            <p className="text-gray-600">
              Please wait while we analyze your interview...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default StartInterview;
