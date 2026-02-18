// App.jsx
import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import "./custom-underline.css";
import movingIcon from "./assets/moving100.png";
import cleaningIcon from "./assets/cleaning100.png";
import otherIcon from "./assets/other1000.png";
import logo from "./assets/Galc-Logo.png";
import "react-datepicker/dist/react-datepicker.css";
import { useLoadScript } from "@react-google-maps/api";
import PlacesAutocomplete from "react-places-autocomplete";
import { geocodeByAddress } from "react-places-autocomplete";

// ✅ Stripe (variable-based keys/urls as requested)
import { loadStripe } from "@stripe/stripe-js";
import { Elements, useStripe, useElements, PaymentElement, PaymentRequestButtonElement } from "@stripe/react-stripe-js";

/** ─────────────────────────────────────────────────────────────────────────────
 *  CONFIG: set these two to your production values
 *  STRIPE key: publishable (pk_live_...)
 *  BACKEND: your Cloud Run base with /public prefix (no trailing slash)
 *  Example: https://your-run-url-xyz.a.run.app/public
 *  ─────────────────────────────────────────────────────────────────────────── */
const STRIPE_PUBLISHABLE_KEY = "pk_live_51HNokpDeRn68o8jxYE5vYtkLZklzNLPNbKR5ViQEmZcOdiCpykj0LtxRGpXQzu8u8J7yuZQvhPGmfGRfopjqUFEM0005uD11nc";
const BACKEND_BASE_URL = "https://prod-webform-backend-1097208953477.us-central1.run.app/public";

// Google Places API (address autocomplete)
const libraries = ["places"];
const GOOGLE_MAPS_API_KEY = "AIzaSyBlDTlWxI4FlQcEneGGKZyw5GyFa_1cOLM";
const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);


// ---------- Helpers for URL params ----------

function parseDateParam(dateStr) {
  // Expect YYYY-MM-DD
  if (!dateStr) return null;
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  // Validate real calendar date
  const test = new Date(y, mo - 1, d);
  if (
    test.getFullYear() !== y ||
    test.getMonth() !== mo - 1 ||
    test.getDate() !== d
  ) return null;

  // Don’t allow past dates (local)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const picked = new Date(y, mo - 1, d);
  picked.setHours(0, 0, 0, 0);
  if (picked < today) return null;

  return { y, mo, d };
}

function safeDecode(v) {
  if (v == null) return "";
  try {
    return decodeURIComponent(String(v));
  } catch {
    return String(v);
  }
}

function buildNotesPrefillFromServices(servicesParam, notesParam) {
  const rawServices = String(servicesParam ?? "").trim();
  const rawNotes = String(notesParam ?? "").trim();

  if (!rawServices) {
    return rawNotes ? rawNotes.slice(0, 120) : null;
  }

  const parts = rawServices
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!parts.length) return rawNotes ? rawNotes.slice(0, 120) : null;

  const first = parts[0];
  const task = parts.length > 1 ? `${first} and more` : first;

  let text = `Task: ${task} (add more details here)`;
  if (rawNotes) text = `${text}\n${rawNotes}`;

  return text.length > 120 ? text.slice(0, 120) : text;
}

function parseTimeParam(raw) {
  if (!raw) return null;

  let s = decodeURIComponent(String(raw)).trim().toLowerCase();
  s = s.replace(/\s+/g, ""); // remove spaces: "8 am" -> "8am"

  // 8am, 8:15am, 12pm, etc.
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (ampm) {
    let h = Number(ampm[1]);
    let m = ampm[2] ? Number(ampm[2]) : 0;
    const ap = ampm[3];

    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 1 || h > 12) return null;
    if (m < 0 || m > 59) return null;

    if (ap === "am") h = h === 12 ? 0 : h;
    if (ap === "pm") h = h === 12 ? 12 : h + 12;

    return { h, m };
  }

  // 08:00, 8:00
  const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 23) return null;
    if (m < 0 || m > 59) return null;
    return { h, m };
  }

  // "8" -> 08:00
  const hh = s.match(/^(\d{1,2})$/);
  if (hh) {
    const h = Number(hh[1]);
    if (!Number.isFinite(h) || h < 0 || h > 23) return null;
    return { h, m: 0 };
  }

  return null;
}
function buildWithin1HrDateTime(dateStr) {
  // Base time = now + 1 hour (local)
  const plus = new Date(Date.now() + 60 * 60 * 1000);

  // Use provided date if valid; otherwise use the date of (now + 1 hour)
  const parsed = parseDateParam(dateStr);
  const base = parsed
    ? new Date(parsed.y, parsed.mo - 1, parsed.d, 0, 0, 0, 0)
    : new Date(plus.getFullYear(), plus.getMonth(), plus.getDate(), 0, 0, 0, 0);

  // Time = (now + 1 hour), rounded up to next 15 minutes
  let totalMins = plus.getHours() * 60 + plus.getMinutes();
  totalMins = Math.ceil(totalMins / 15) * 15;

  // Clamp to dropdown supported window: 06:00 -> 22:00
  const minMins = 6 * 60;
  const maxMins = 22 * 60;
  totalMins = Math.min(Math.max(totalMins, minMins), maxMins);

  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;

  base.setHours(h, m, 0, 0);
  return base;
}

function getParam(params, key) {
  // URLSearchParams already decodes %xx for you.
  // This only converts "+" to spaces if someone uses that style.
  const v = params.get(key);
  return (v ?? "").replace(/\+/g, " ").trim();
}


function buildDateTimeFromParams(dateStr, timeStr) {
  // Special case: time=within1hr (or a few common variants)
  const raw = timeStr == null ? "" : decodeURIComponent(String(timeStr)).trim().toLowerCase();
  const normalized = raw.replace(/\s+/g, "");

  if (["within1hr", "within_1hr", "within1hour", "withinanhour"].includes(normalized)) {
    // Returns a normal Date object that matches your dropdown constraints
    return buildWithin1HrDateTime(dateStr);
  }

  const date = parseDateParam(dateStr);
  const time = parseTimeParam(timeStr);
  if (!date || !time) return null;

  // Only allow times your dropdown supports: 6:00 -> 22:00, 15-min increments
  const totalMins = time.h * 60 + time.m;
  const minMins = 6 * 60;
  const maxMins = 22 * 60;
  if (totalMins < minMins || totalMins > maxMins) return null;
  if (time.m % 15 !== 0) return null;

  return new Date(date.y, date.mo - 1, date.d, time.h, time.m, 0, 0);
}
// ---------- Helpers (pricing mirror, minimal UI) ----------
function round2(n) {
  return Math.round(n * 100) / 100;
}
function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || "");
}
function calcProcessingFeeBase({ laborSubtotal, toolsTotal, backgroundCheckFee }) {
  // Include background check fee in processing fee calculation
  return laborSubtotal + toolsTotal + backgroundCheckFee;
}
function computeMinimalTotals({ duration, workers, tools, isSameDay, discountAmount = 0, discountType = null, percentOff = null }) {
  const reg = { 2: 110, 5: 190, 8: 240 }[duration] ?? 110;
  const sd = { 2: 127, 5: 219, 8: 276 }[duration] ?? 127;
  const per = isSameDay ? sd : reg;

  const baseLaborCost = Number(per) * Number(workers || 1);
  const backgroundCheckFee = 6 * Number(workers || 0);
  const toolsTotal = tools ? 100 : 0;

  const feeBase = calcProcessingFeeBase({ laborSubtotal: baseLaborCost, toolsTotal, backgroundCheckFee });
  const processingFee = round2(feeBase * 0.029 + 1.8);

  const subtotal = round2(baseLaborCost + backgroundCheckFee + toolsTotal + processingFee);
  
  // Calculate discount based on type
  let discount = 0;
  if (discountType === "percentage" && percentOff !== null && percentOff > 0) {
    // For percentage discounts, calculate from subtotal (which includes processing fees)
    discount = round2(subtotal * (percentOff / 100));
  } else if (discountType === "fixed" && discountAmount > 0) {
    // For fixed discounts, use the amount directly
    discount = round2(Math.min(discountAmount, subtotal)); // Don't allow discount to exceed subtotal
  }
  
  const totalDueNow = round2(subtotal - discount);

  return { baseLaborCost, backgroundCheckFee, toolsTotal, processingFee, subtotal, discount, totalDueNow };
}

// ---------- Final CostBreakdown (labels lighter gray, amounts same size) ----------
// ---------- Final CostBreakdown (Workers/Tools/Processing in text-gray-500) ----------
function CostBreakdown({ values, discountAmount = 0, discountType = null, percentOff = null, couponCode = null }) {
  const isSameDay = values.datetime
    ? values.datetime.toDateString() === new Date().toDateString()
    : false;

  const { baseLaborCost, backgroundCheckFee, toolsTotal, processingFee, discount, totalDueNow } =
    computeMinimalTotals({
      duration: Number(values.duration),
      workers: Number(values.workers),
      tools: !!values.tools,
      isSameDay,
      discountAmount,
      discountType,
      percentOff,
    });

  return (
    <div className="mt-12">
      {/* Section Header */}
      <h3 className="block text-sm font-semibold text-[#04193b]/80 mb-4">
        Cost Breakdown
      </h3>

      {/* Breakdown List */}
      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Labor Cost</span>
          <span className="text-sm text-gray-500">
            ${baseLaborCost.toFixed(2)}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Worker Quality Fee</span>
          <span className="text-sm text-gray-500">
            ${backgroundCheckFee.toFixed(2)}
          </span>
        </div>

        {values.tools && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Tools Cost</span>
            <span className="text-sm text-gray-500">
              ${toolsTotal.toFixed(2)}
            </span>
          </div>
        )}

        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Processing Fee</span>
          <span className="text-sm text-gray-500">
            ${processingFee.toFixed(2)}
          </span>
        </div>

        {discount > 0 && couponCode && (
          <div className="flex justify-between">
            <span className="text-sm text-green-600">Discount ({couponCode})</span>
            <span className="text-sm text-green-600">
              -${discount.toFixed(2)}
            </span>
          </div>
        )}

        {/* Divider + Total */}
        <div className="border-t border-gray-300 mt-6 pt-4 flex justify-between">
          <span className="text-sm font-semibold text-[#04193b]/80">
            Total due
          </span>
          <span className="text-sm text-[#04193b]">
            ${totalDueNow.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Note */}
      <div className="text-sm text-gray-500 mt-4 leading-relaxed space-y-2">
        <div>
          {(() => {
            if (!values.datetime) {
              return "A hold will be placed on your card 1 day before the job. No charges until after completion.";
            }
            const daysUntilJob = Math.ceil(
              (values.datetime - new Date()) / (1000 * 60 * 60 * 24)
            );
            if (daysUntilJob > 2) {
              return "A hold will be placed on your card 1 day before the job. No charges until after completion.";
            } else {
              return "A hold will be placed on your card. No charges until after job completion.";
            }
          })()}
        </div>
        <div>
          This service provides labor only. Trucks and transportation are not included.
        </div>
      </div>
    </div>
  );
}


// ---------- Payment Submit Button (with Stripe Elements access) ----------
function PaymentSubmitButton({ values, validate, onBooked, setTouched, setErrors, clientSecret, jobTimezoneOffset, isSameDayJob, setPaymentError, discountAmount = 0, discountType = null, percentOff = null, couponValid = null }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [canMakePayment, setCanMakePayment] = useState(false);
  const [missingFields, setMissingFields] = useState([]);
  const [canUseDigitalWallet, setCanUseDigitalWallet] = useState(false);

  // Check for missing mandatory fields
  const checkMissingFields = useCallback(() => {
    const missing = [];
    
    if (!values.first_name?.trim()) missing.push("First Name");
    if (!values.last_name?.trim()) missing.push("Last Name");
    if (!values.email?.trim() || !isValidEmail(values.email)) missing.push("Email");
    if (!values.phone?.trim() || !/^\d{10}$/.test(values.phone)) missing.push("Phone Number");
    if (!values.company_name?.trim()) missing.push("Company Name");
    if (!values.service) missing.push("Service Type");
    if (!values.datetime) missing.push("Date & Time");
    if (!values.address?.trim()) missing.push("Address");
    if (!values.notes?.trim() || values.notes.trim().length < 15) missing.push("Notes for Workers");
    if (!values.terms_accepted) missing.push("Terms & Conditions");
    
    // Check tools description if tools are selected
    if (values.tools && !values.tools_description?.trim()) {
      missing.push("Tools Description");
    }
    
    // PaymentElement handles card information automatically, no need to check card fields
    setMissingFields(missing);
    return missing.length === 0;
  }, [values]);

  // Check missing fields whenever values change
  useEffect(() => {
    try {
      const isValid = checkMissingFields();
      setCanUseDigitalWallet(isValid);
    } catch (error) {
      console.error('Field validation error:', error);
      setCanUseDigitalWallet(false);
    }
  }, [values, checkMissingFields]);

  const buildPayload = useCallback(async (setupIntentId) => {
    // Use stored state and zipcode from geocoded address components
    const formatted = values.address || "";
    const [street = formatted, city = ""] = formatted.split(",").map((s) => (s || "").trim());
    const state = values.state || "";
    const postalCode = values.zipcode || "";

    // Use local date components to avoid timezone conversion issues
    const year = values.datetime.getFullYear();
    const month = (values.datetime.getMonth() + 1).toString().padStart(2, "0");
    const day = values.datetime.getDate().toString().padStart(2, "0");
    const date = `${year}-${month}-${day}`;
    const hh = values.datetime.getHours().toString().padStart(2, "0");
    const mm = values.datetime.getMinutes().toString().padStart(2, "0");
    const time = `${hh}:${mm}`;

    // Determine if this is a same day job based on job location timezone
    const immediateHold = isSameDayJob(values.datetime, jobTimezoneOffset);

    return {
      setup_intent_id: setupIntentId,
      clientInfo: {
        firstName: values.first_name,
        lastName: values.last_name,
        email: values.email,
        phone: values.phone,
        paymentPhoneNumber: values.phone,
        company_name: values.company_name,
        addresses: [
          { formatted, street, city, state, postalCode, country: "US" },
        ],
        source: "Web",
      },
      jobDetails: {
        date,
        time,
        workers: Number(values.workers),
        duration: String(values.duration), // '2' | '5' | '8'
        bookingType: "premium",
        jobDescription: values.notes || "",
        servicesRequested: values.service ? [values.service] : [],
        needsTools: !!values.tools,
        specificTools: values.tools ? (values.tools_description || "Tools requested") : "",
        immediateHold, // Same day logic based on job location timezone
        couponCode: values.coupon_code?.trim() && couponValid === true ? values.coupon_code.trim().toUpperCase() : null,
      },
    };
  }, [values, jobTimezoneOffset, isSameDayJob, couponValid]);

  // Create PaymentRequest for digital wallets
  const paymentRequest = useMemo(() => {
    if (!stripe) return null;

    try {
      const isSameDay = values.datetime
        ? values.datetime.toDateString() === new Date().toDateString()
        : false;

      const { totalDueNow } = computeMinimalTotals({
        duration: Number(values.duration),
        workers: Number(values.workers),
        tools: !!values.tools,
        isSameDay,
        discountAmount,
        discountType,
        percentOff,
      });

      const pr = stripe.paymentRequest({
        country: 'US',
        currency: 'usd',
        total: {
          label: 'Community Labor Partnership',
          amount: Math.round(totalDueNow * 100), // Convert to cents
        },
        requestPayerName: true,
        requestPayerEmail: true,
        displayItems: [
          {
            label: 'Labor Service',
            amount: Math.round(totalDueNow * 100),
          },
        ],
      });

      // Handle payment method creation
      pr.on('paymentmethod', async (ev) => {
        try {
          // Clear any previous payment errors
          setPaymentError(null);
          
          // Confirm the setup intent with the payment method
          const { error: confirmError, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
            payment_method: ev.paymentMethod.id,
          });

          if (confirmError) {
            console.error('Payment confirmation error:', confirmError);
            ev.complete('fail');
            return;
          }

          // Create booking with backend
          const payload = await buildPayload(setupIntent.id);
          const res = await fetch(`${BACKEND_BASE_URL}/bookings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const json = await res.json();
          
          if (!res.ok) {
            console.error('Booking failed:', json);
            // Handle card hold failure specifically
            if (json.error === 'payment_failed') {
              setPaymentError('There was an error when trying to place a hold on the card. Please try a different payment method.');
            } else {
              setPaymentError('Payment failed. Please try again.');
            }
            ev.complete('fail');
            return;
          }

          ev.complete('success');
          onBooked(json);
        } catch (err) {
          console.error('Payment method error:', err);
          ev.complete('fail');
        }
      });

      return pr;
    } catch (error) {
      console.error('PaymentRequest creation error:', error);
      return null;
    }
  }, [stripe, values.duration, values.workers, values.tools, values.datetime, clientSecret, onBooked, buildPayload, setPaymentError, discountAmount, discountType, percentOff]);

  // Check if payment request can make payments
  useEffect(() => {
    if (!paymentRequest) {
      setCanMakePayment(false);
      return;
    }

    paymentRequest.canMakePayment()
      .then((result) => {
        // Payment methods available - logging removed
        // Only enable if Apple Pay or Google Pay are available (not just Link)
        const hasDigitalWallet = result && (result.applePay || result.googlePay);
        setCanMakePayment(!!hasDigitalWallet);
      })
      .catch((error) => {
        console.error('canMakePayment error:', error);
        setCanMakePayment(false);
      });
  }, [paymentRequest]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Clear any previous payment errors
    setPaymentError(null);

    // Mark everything touched so inline red errors show
    setTouched({
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
      service: true,
      datetime: true,
      address: true,
      notes: true,
      formSubmitted: true,
    });

    const currentErrors = await validate(values);
    setErrors(currentErrors);

    // If any errors, stop here (errors will display inline)
    if (Object.keys(currentErrors).length > 0) {
      return;
    }

    if (!stripe || !elements) return;

    try {
      setBusy(true);

      // Confirm the setup intent with PaymentElement
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (confirmError) throw new Error(confirmError.message || "Setup intent confirmation failed.");

      const setupIntentId = setupIntent?.id;
      if (!setupIntentId) throw new Error("Missing Setup Intent ID.");

      // Create booking with backend
      const payload = await buildPayload(setupIntentId);
      const res = await fetch(`${BACKEND_BASE_URL}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        // Handle card hold failure specifically
        if (json.error === 'payment_failed') {
          setPaymentError('There was an error when trying to place a hold on the card. Please try a different payment method.');
        } else {
          setPaymentError('Payment failed. Please try again.');
        }
        throw new Error(json.detail || "Booking failed.");
      }

      onBooked(json);
    } catch (err) {
      console.error(err);
      // Errors will show in console, form remains visible
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Digital Wallet Payment Button */}
      {canMakePayment && paymentRequest && canUseDigitalWallet && (
        <div className="w-full">
          {(() => {
            try {
              return (
                <PaymentRequestButtonElement
                  options={{
                    paymentRequest,
                    style: {
                      paymentRequestButton: {
                        type: 'default',
                        theme: 'dark',
                        height: '48px',
                      },
                    },
                  }}
                />
              );
            } catch (error) {
              console.error('PaymentRequestButtonElement render error:', error);
              return null;
            }
          })()}
        </div>
      )}
      
      {/* Divider */}
      {canMakePayment && paymentRequest && canUseDigitalWallet && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">Or pay with card</span>
          </div>
        </div>
      )}

      {/* Missing Fields Message */}
      {missingFields.length > 0 && (
        <div className="text-sm text-gray-600 mt-4 p-3 bg-gray-50 rounded-lg">
          Please complete the following fields:
          <ul className="mt-2 list-disc list-inside">
            {missingFields.map((field, index) => (
              <li key={index}>{field}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Traditional Card Submit Button */}
      <button
        type="button"
        disabled={busy || !stripe || missingFields.length > 0}
        onClick={handleSubmit}
        className="w-full mt-6 py-3 sm:py-5 px-6 rounded-xl font-extrabold text-base sm:text-lg shadow-md bg-[#04193b] text-white hover:bg-[#a2d2ff] hover:text-[#04193b] border border-transparent active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Processing..." : missingFields.length > 0 ? "Complete Required Fields" : "Submit"}
      </button>
    </div>
  );
}


// ---------- Main App ----------
export default function App() {
  // Global error handler to prevent white screen crashes
  useEffect(() => {
    const handleError = (error) => {
      console.error('Global error caught:', error);
      // Don't let the app crash completely
    };
    
    const handleUnhandledRejection = (event) => {
      console.error('Unhandled promise rejection:', event.reason);
      event.preventDefault(); // Prevent the default browser behavior
    };
    
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const [mobileStroke, setMobileStroke] = useState(8);
  const [activeIndex, setActiveIndex] = useState(null);

  // Form values
  const [values, setValues] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    company_name: "",
    service: "",
    workers: 1,
    duration: 2,
    datetime: null,
    address: "",
    state: "",
    zipcode: "",
    tools: false,
    tools_description: "",
    notes: "",
    terms_accepted: false,
    coupon_code: "",
  });

  const prefillAppliedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;

    // Clean URL = no changes
    const search = window.location.search;
    if (!search || search === "?") return;

    const params = new URLSearchParams(search);

    const next = {};

    // workers=3 (1..10)
    const wRaw = params.get("workers");
    if (wRaw != null) {
      const w = parseInt(wRaw, 10);
      if (Number.isFinite(w) && w >= 1 && w <= 10) next.workers = w;
    }

    // duration=2 (allowed: 2,5,8)
    const dRaw = params.get("duration");
    if (dRaw != null) {
      const d = parseInt(dRaw, 10);
      if ([2, 5, 8].includes(d)) next.duration = d;
    }

    // date=YYYY-MM-DD & time=8am / 08:00 / 8:15am
      const dt = buildDateTimeFromParams(params.get("date"), params.get("time"));
      if (dt) next.datetime = dt;

      // ✅ services -> notes template (first service + "and more" if multiple)
      const servicesStr = getParam(params, "services");
      const notesStr = getParam(params, "notes");

      const notesPrefill = buildNotesPrefillFromServices(servicesStr, notesStr);
      if (notesPrefill) next.notes = notesPrefill;

      // If nothing valid, do nothing
      if (Object.keys(next).length === 0) return;

      // Apply without marking fields "touched" (keeps behavior clean)
      setValues((v) => {
        // don't overwrite notes if the user already typed something
        if (next.notes && v.notes?.trim()) {
          const { notes, ...rest } = next;
          return { ...v, ...rest };
        }
        return { ...v, ...next };
      });
  }, []);

  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [clientSecret, setClientSecret] = useState(null);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [paymentError, setPaymentError] = useState(null);
  const lastInitRef = useRef({ email: null });
  const [focusedField, setFocusedField] = useState(null);
  const [filteredSuggestions, setFilteredSuggestions] = useState([]);
  const [addressSelected, setAddressSelected] = useState(false);
  const [jobTimezoneOffset, setJobTimezoneOffset] = useState(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponDiscountType, setCouponDiscountType] = useState(null); // "percentage" | "fixed" | null
  const [couponPercentOff, setCouponPercentOff] = useState(null); // percentage value for percentage discounts
  const [couponValid, setCouponValid] = useState(null); // null = not checked, true = valid, false = invalid
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  // Google Places loader
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries,
  });

  // Function to get timezone from address
  const getTimezoneFromAddress = useCallback(async (address) => {
    if (!address) return null;
    
    try {
      const results = await geocodeByAddress(address);
      if (results && results.length > 0) {
        const location = results[0].geometry.location;
        const lng = location.lng();
        
        // Use a timezone API to get timezone from coordinates
        // For now, we'll use a simple approximation based on longitude
        // In production, you might want to use a proper timezone API
        const timezoneOffset = Math.round(lng / 15); // Rough approximation
        return timezoneOffset;
      }
    } catch {
      // Return null if geocoding fails
      return null;
    }
    
    return null;
  }, []);

  // Function to check if job is same day based on job location timezone
  const isSameDayJob = useCallback((jobDateTime, jobTimezoneOffset) => {
    if (!jobDateTime || jobTimezoneOffset === null) return false;
    
    // Create a date in the job's timezone
    const jobTimeInJobTz = new Date(jobDateTime.getTime() + (jobTimezoneOffset * 60 * 60 * 1000));
    
    // Get current time in job's timezone
    const nowInJobTz = new Date(Date.now() + (jobTimezoneOffset * 60 * 60 * 1000));
    
    // Get dates (without time)
    const jobDate = new Date(jobTimeInJobTz.getFullYear(), jobTimeInJobTz.getMonth(), jobTimeInJobTz.getDate());
    const todayInJobTz = new Date(nowInJobTz.getFullYear(), nowInJobTz.getMonth(), nowInJobTz.getDate());
    const tomorrowInJobTz = new Date(todayInJobTz.getTime() + (24 * 60 * 60 * 1000));
    
    // Check if job date is today or tomorrow in the job's timezone
    const isToday = jobDate.getTime() === todayInJobTz.getTime();
    const isTomorrow = jobDate.getTime() === tomorrowInJobTz.getTime();
    
    return isToday || isTomorrow;
  }, []);

  // Function to filter suggestions to only include addresses with state and zipcode
  const filterSuggestionsWithStateAndZip = useCallback(async (suggestions) => {
    const validSuggestions = [];
    
    // Limit to first 5 suggestions to reduce API calls
    const limitedSuggestions = suggestions.slice(0, 5);
    
    for (const suggestion of limitedSuggestions) {
      try {
        const results = await geocodeByAddress(suggestion.description);
        if (results && results.length > 0) {
          const components = results[0].address_components || [];
          const state = components.find((c) => c.types.includes("administrative_area_level_1"));
          const zipcode = components.find((c) => c.types.includes("postal_code"));
          
          if (state && zipcode) {
            validSuggestions.push(suggestion);
          }
        }
      } catch {
        // Skip this suggestion if geocoding fails - no logging
        continue;
      }
    }
    
    return validSuggestions;
  }, []);



  // State to track current suggestions for filtering
  const [currentSuggestions, setCurrentSuggestions] = useState([]);

  // Debounced filtering to reduce API calls
  const filterTimeoutRef = useRef(null);

  // Effect to filter suggestions when they change (with debouncing)
  useEffect(() => {
    if (filterTimeoutRef.current) {
      clearTimeout(filterTimeoutRef.current);
    }

    // Don't filter if address has been selected
    if (addressSelected) {
      setFilteredSuggestions([]);
      return;
    }

    if (currentSuggestions.length > 0) {
      filterTimeoutRef.current = setTimeout(() => {
        filterSuggestionsWithStateAndZip(currentSuggestions).then(setFilteredSuggestions);
      }, 300); // 300ms debounce
    } else {
      setFilteredSuggestions([]);
    }

    return () => {
      if (filterTimeoutRef.current) {
        clearTimeout(filterTimeoutRef.current);
      }
    };
  }, [currentSuggestions, filterSuggestionsWithStateAndZip, addressSelected]);

  
  // Add CSS to remove default focus outlines and suppress console warnings
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      input:focus,
      textarea:focus,
      select:focus {
        outline: none !important;
        box-shadow: none !important;
      }
      
      /* Remove Stripe element focus outlines */
      .stripe-input:focus-within {
        outline: none !important;
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(style);

    // Suppress console warnings and errors
    const originalWarn = console.warn;
    const originalError = console.error;
    
    console.warn = function(...args) {
      const message = args.join(' ');
      // Suppress specific warnings
      if (
        message.includes('Each dictionary in the list "icons"') ||
        message.includes('should contain a non-empty UTF8 string field') ||
        message.includes('Added non-passive event listener') ||
        message.includes('scroll-blocking') ||
        message.includes('google.maps.places.AutocompleteService') ||
        message.includes('As of March 1st, 2025')
      ) {
        return; // Don't log these warnings
      }
      originalWarn.apply(console, args);
    };

    console.error = function(...args) {
      const message = args.join(' ');
      // Suppress specific errors (like manifest validation)
      if (
        message.includes('Each dictionary in the list "icons"') ||
        message.includes('should contain a non-empty UTF8 string field') ||
        message.includes('Added non-passive event listener') ||
        message.includes('scroll-blocking') ||
        message.includes('google.maps.places.AutocompleteService') ||
        message.includes('As of March 1st, 2025')
      ) {
        return; // Don't log these errors
      }
      originalError.apply(console, args);
    };
    
    return () => {
      document.head.removeChild(style);
      console.warn = originalWarn; // Restore original console.warn
      console.error = originalError; // Restore original console.error
    };
  }, []);



  useEffect(() => {
    const updateStroke = () => setMobileStroke(window.innerWidth < 640 ? 16 : 8);
    updateStroke();
    window.addEventListener("resize", updateStroke);
    return () => window.removeEventListener("resize", updateStroke);
  }, []);

  // Validation (keep minimal but solid)
  // Validation (solid, includes address geocode)
const validate = useCallback(async (vals) => {
  const errs = {};

  if (!isValidEmail(vals.email)) {
    errs.email = "Enter a valid email.";
  }

  if (!/^\d{10}$/.test(vals.phone || "")) {
    errs.phone = "Enter a 10-digit US phone (numbers only)";
  }

  if (!vals.company_name?.trim()) {
    errs.company_name = "Enter company name.";
  }

  if (!vals.service) {
    errs.service = "Select a service.";
  }

  if (!vals.datetime) {
    errs.datetime = "Select date & time.";
  }

  // 🏠 Address validation with geocode
  if (!vals.address) {
    errs.address = "Enter an address.";
  } else {
    try {
      const results = await geocodeByAddress(vals.address);
      if (!results || !results.length) {
        errs.address = "Please enter a valid US address.";
      } else {
        const components = results[0].address_components || [];
        const country = components.find((c) => c.types.includes("country"))?.short_name;
        const state = components.find((c) => c.types.includes("administrative_area_level_1"))?.short_name;
        const zipcode = components.find((c) => c.types.includes("postal_code"))?.long_name;

        if (!country) {
          errs.address = "Could not determine country for this address.";
        } else if (country !== "US") {
          errs.address = "Sorry, we only serve addresses in the USA.";
        } else if (!state || !zipcode) {
          errs.address = "Please enter an address that includes both state and zipcode.";
        }
      }
    } catch (err) {
      // Handle ZERO_RESULTS and other geocoding errors gracefully
      if (err.code === 'ZERO_RESULTS' || err.status === 'ZERO_RESULTS') {
        errs.address = "Please enter a valid US address.";
      } else {
        // Geocode error - logging removed
        errs.address = "Please pick a valid address.";
      }
    }
  }

  // Notes validation - now mandatory with minimum 15 characters
  if (!vals.notes || vals.notes.trim().length < 15) {
    errs.notes = "Please provide a few notes for the workers.";
  }

  // Terms and conditions validation - mandatory
  if (!vals.terms_accepted) {
    errs.terms_accepted = "You must accept the terms and conditions to continue.";
  }

  return errs;
}, []);


  // Keep errors in sync - only validate when form is submitted or fields are touched
  useEffect(() => {
    // Don't run validation on initial load
    if (!touched.formSubmitted && Object.keys(touched).length === 0) {
      return;
    }
    
    (async () => setErrors(await validate(values)))();
  }, [touched, values, validate]); // Only run when touched state changes, not on every value change

  // Automatically initialize SetupIntent once name+email look valid
  useEffect(() => {
    const ok =
      values.first_name?.trim() &&
      values.last_name?.trim() &&
      isValidEmail(values.email);

    const emailChanged = lastInitRef.current.email !== values.email;

    if (!ok) return;

    // Debounce a bit
    const t = setTimeout(async () => {
      if (!emailChanged && clientSecret) return;
      try {
        const resp = await fetch(`${BACKEND_BASE_URL}/setup-intents/init`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: values.email,
            name: `${values.first_name} ${values.last_name}`.trim(),
          }),
        });
        const json = await resp.json();
        if (!resp.ok || !json.client_secret) {
          throw new Error(json.detail || "Failed to init payment.");
        }
        setClientSecret(json.client_secret);
        lastInitRef.current.email = values.email;
      } catch {
        // Silently handle SetupIntent init failure
      }
    }, 350);

    return () => clearTimeout(t);
  }, [values.first_name, values.last_name, values.email]); // eslint-disable-line

  // Redirect to confirmation page after successful booking
  function handleBooked(json) {
    console.log("Booking response:", json);
  
    const redirectUrl = "https://www.greatamericanlabor.com/confirmation";
  
    if (typeof window.gtag === "function") {
      window.gtag("event", "booking_completed", {
        service_type: values.service || "unknown",
        workers: Number(values.workers || 1),
        duration_hours: Number(values.duration || 2),
        event_callback: () => {
          window.location.href = redirectUrl;
        },
        event_timeout: 2000,
      });
  
      // Safety fallback in case event_callback never fires
      setTimeout(() => {
        window.location.href = redirectUrl;
      }, 2100);
  
      return;
    }
  
    // If gtag isn't available for some reason, just redirect
    window.location.href = redirectUrl;
  }

  // Validate coupon with backend
  const validateCoupon = useCallback(async (couponCode) => {
    if (!couponCode || !couponCode.trim()) {
      setCouponValid(null);
      setCouponDiscount(0);
      setCouponDiscountType(null);
      setCouponPercentOff(null);
      return;
    }

    setValidatingCoupon(true);
    try {
      const res = await fetch(`${BACKEND_BASE_URL}/coupons/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupon_code: couponCode.trim().toUpperCase() }),
      });
      const json = await res.json();
      
      if (res.ok && json.valid) {
        setCouponValid(true);
        setCouponDiscountType(json.discount_type || null);
        
        if (json.discount_type === "percentage") {
          // For percentage discounts, store the percentage and let frontend calculate amount
          setCouponPercentOff(json.percent_off || null);
          setCouponDiscount(0); // Will be calculated based on current total
        } else if (json.discount_type === "fixed") {
          // For fixed discounts, use the amount directly
          setCouponDiscount(Number(json.discount_amount || 0));
          setCouponPercentOff(null);
        } else {
          // Fallback for old response format
          setCouponDiscount(Number(json.discount_amount || 0));
          setCouponPercentOff(null);
        }
      } else {
        setCouponValid(false);
        setCouponDiscount(0);
        setCouponDiscountType(null);
        setCouponPercentOff(null);
      }
    } catch (err) {
      console.error("Coupon validation error:", err);
      setCouponValid(false);
      setCouponDiscount(0);
      setCouponDiscountType(null);
      setCouponPercentOff(null);
    } finally {
      setValidatingCoupon(false);
    }
  }, []);

  // Handle Apply button click
  const handleApplyCoupon = useCallback(() => {
    const code = values.coupon_code?.trim();
    if (code) {
      validateCoupon(code);
    }
  }, [values.coupon_code, validateCoupon]);

  // UI constants
  const fields = [
    { label: "First Name", type: "text", name: "first_name" },
    { label: "Last Name", type: "text", name: "last_name" },
    { label: "Email", type: "text", name: "email" },
    { label: "Phone Number", type: "tel", name: "phone" },
  ];

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-white overflow-hidden">
      {/* SVG Background */}
      <svg
        className="absolute left-0 top-0 w-full h-full z-10 pointer-events-none"
        viewBox="0 0 1600 900"
        fill="none"
        preserveAspectRatio="none"
      >
        <path
          d="M0,100 Q400,750 800,400 Q1200,50 1600,800 L1600,0 L0,0 Z"
          fill="#ef4444"
          fillOpacity="0.13"
          stroke="none"
        />
        <path
          d="M0,100 Q400,750 800,400 Q1200,50 1600,800"
          fill="none"
          stroke="#ef4444"
          strokeWidth={mobileStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0px 4px 18px #ef444433)" }}
        />
      </svg>

      {/* Main Form Card */}
      <div className="relative max-w-[60rem] w-full rounded-2xl shadow-3xl bg-white/80 backdrop-blur-lg border border-[#e7eaf0] pt-4 pb-12 px-4 sm:pt-5 sm:pb-20 sm:px-8 md:px-20 flex flex-col z-20">
        {/* Header Section with Logo and Title */}
        <div className="mb-14">
          {/* Logo at very top, centered */}
          <div className="flex justify-center mb-3">
            <img 
              src={logo} 
              alt="Great American Labor" 
              className="h-16 w-40 sm:h-24 sm:w-60 rounded-xl object-contain"
            />
          </div>
          {/* Title and subtitle below logo */}
          <div className="text-center">
            <h1 className="text-2xl sm:text-[2rem] font-black text-[#04193b] mb-3">Hire with Confidence</h1>
            <div className="text-[#04193b]/80 text-base sm:text-[1rem]">Skilled workers – Trusted by thousands.</div>
          </div>
        </div>

        {/* Spotlights */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-56 h-24 bg-[#a2d2ff99] blur-3xl opacity-50 pointer-events-none"></div>
        <div className="absolute -bottom-14 left-8 w-36 h-14 bg-[#04193b55] blur-2xl opacity-30 pointer-events-none"></div>

        {/* Success Page */}
        {bookingSuccess ? (
          <div className="w-full text-center space-y-6">
            <div className="w-20 h-20 mx-auto bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-[#04193b]">Booking Confirmed!</h2>
            <p className="text-[#04193b]/80 text-lg">
              Thank you for your booking. Please check your email for confirmation details.
            </p>
            <div className="pt-4">
              <button
                onClick={() => {
                  setBookingSuccess(false);
                  setValues({
                    first_name: "",
                    last_name: "",
                    email: "",
                    phone: "",
                    company_name: "",
                    service: "",
                    workers: 1,
                    duration: 2,
                    datetime: null,
                    address: "",
                    state: "",
                    zipcode: "",
                    tools: false,
                    tools_description: "",
                    notes: "",
                    terms_accepted: false,
                    coupon_code: "",
                  });
                  setClientSecret(null);
                  setCouponDiscount(0);
                  setCouponDiscountType(null);
                  setCouponPercentOff(null);
                  setCouponValid(null);
                }}
                className="px-8 py-3 bg-[#04193b] text-white rounded-xl font-semibold hover:bg-[#a2d2ff] hover:text-[#04193b] transition-colors"
              >
                Book Another Job
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Form (customer details) */}
            <form className="w-full space-y-8" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
          {/* Names */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {fields.slice(0, 2).map((field, i) => (
              <div
                key={field.name}
                className="mb-2"
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <div className="relative">
                  <label htmlFor={field.name} className="block text-sm font-semibold text-[#04193b]/80 mb-4">
                    {field.label}
                  </label>
                  <input
                    id={field.name}
                    name={field.name}
                    type={field.type}
                    value={values[field.name]}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    onFocus={() => setActiveIndex(i)}
                    onBlur={() => setActiveIndex(null)}
                    className="w-full bg-transparent border border-gray-200 rounded-lg px-3 py-2 text-base font-normal text-[#04193b] transition-all"
                  />
                  <span
                    className={`pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 h-0.5 bg-[#04193b] rounded ${
                      activeIndex === i ? "input-underline-animate" : "input-underline-reset"
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Email + Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {fields.slice(2).map((field, i) => (
              <div
                key={field.name}
                className="mb-2"
                onMouseEnter={() => setActiveIndex(i + 2)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <div className="relative">
                  <label htmlFor={field.name} className="block text-sm font-semibold text-[#04193b]/80 mb-4">
                    {field.label}
                  </label>
                  <input
                    id={field.name}
                    name={field.name}
                    type={field.type}
                    value={values[field.name]}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    onFocus={() => setActiveIndex(i + 2)}
                    onBlur={() => setActiveIndex(null)}
                    className="w-full bg-transparent border border-gray-200 rounded-lg px-3 py-2 text-base font-normal text-[#04193b] transition-all"
                  />
                  <span
                    className={`pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 h-0.5 bg-[#04193b] rounded ${
                      activeIndex === i + 2 ? "input-underline-animate" : "input-underline-reset"
                    }`}
                  />
                </div>
                {["email", "phone"].includes(field.name) &&
                    touched[field.name] &&
                    errors[field.name] && (
                      <div className="text-red-500 text-sm mt-2">{errors[field.name]}</div>
                    )}
              </div>
            ))}
          </div>

          {/* Company Name */}
          <div className="mb-2"
            onMouseEnter={() => setActiveIndex(6)}
            onMouseLeave={() => setActiveIndex(null)}>
            <div className="relative">
              <label htmlFor="company_name" className="block text-sm font-semibold text-[#04193b]/80 mb-4">
                Company Name
              </label>
              <input
                id="company_name"
                name="company_name"
                type="text"
                value={values.company_name}
                onChange={(e) => setValues((v) => ({ ...v, company_name: e.target.value }))}
                onFocus={() => setActiveIndex(6)}
                onBlur={() => setActiveIndex(null)}
                className="w-full bg-transparent border border-gray-200 rounded-lg px-3 py-2 text-base font-normal text-[#04193b] transition-all"
              />
              <span
                className={`pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 h-0.5 bg-[#04193b] rounded ${
                  activeIndex === 6 ? "input-underline-animate" : "input-underline-reset"
                }`}
              />
            </div>
            {touched.company_name && errors.company_name && (
              <div className="text-red-500 text-sm mt-2">{errors.company_name}</div>
            )}
          </div>

          {/* Services */}
          <div className="mt-12">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[{ name: "Moving", icon: movingIcon }, { name: "Cleaning", icon: cleaningIcon }, { name: "Other", icon: otherIcon }].map(
                (service) => (
                  <div
                    key={service.name}
                    onClick={() => setValues((v) => ({ ...v, service: service.name }))}
                    className={`flex flex-col items-center justify-center p-6 rounded-2xl cursor-pointer border shadow-sm text-center transition-all duration-500 ease-in-out ${
                      values.service === service.name
                        ? "border-[#04193b] ring-2 ring-[#04193b]"
                        : "border-gray-200 hover:shadow-md"
                    }`}
                  >
                    <img src={service.icon} alt={service.name} className="h-16 w-16 mb-4 object-contain" />
                    <span className="text-base font-semibold text-[#04193b]">{service.name}</span>
                  </div>
                )
              )}
            </div>
            {touched.service && errors.service && (
                <div className="text-red-500 text-sm mt-2">{errors.service}</div>
              )}

          </div>

          {/* Workers & Duration */}
          <div className="mt-12 space-y-12">
            <div>
              <label className="block text-sm font-semibold text-[#04193b]/80 mb-4">Number of Workers</label>
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <div
                    key={num}
                    onClick={() => setValues((v) => ({ ...v, workers: num }))}
                    className={`flex items-center justify-center h-14 rounded-xl cursor-pointer border text-base font-semibold transition-all duration-500 ease-in-out ${
                      values.workers === num
                        ? "border-[#04193b] ring-2 ring-[#04193b]"
                        : "border-gray-200 hover:shadow-md"
                    }`}
                  >
                    {num}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#04193b]/80 mb-4">Duration</label>
              <div className="grid grid-cols-3 gap-4">
                {[2, 5, 8].map((hrs) => (
                  <div
                    key={hrs}
                    onClick={() => setValues((v) => ({ ...v, duration: hrs }))}
                    className={`flex items-center justify-center h-14 rounded-xl cursor-pointer border text-base font-semibold ${
                      values.duration === hrs ? "border-[#04193b] ring-2 ring-[#04193b]" : "border-gray-200 hover:shadow-md"
                    }`}
                  >
                    <span className="sm:hidden">{hrs} hours</span>
                    <span className="hidden sm:inline">{hrs} hours or less</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Date & Time */}
          <div className="mt-12">
            <label className="block text-sm font-semibold text-[#04193b]/80 mb-4">
              Date & Time
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Date Picker */}
              <input
                type="date"
                min={new Date().toISOString().split("T")[0]}
                value={
                  values.datetime
                    ? new Date(values.datetime.getTime() - values.datetime.getTimezoneOffset() * 60000)
                        .toISOString()
                        .split("T")[0]
                    : ""
                }
                onChange={(e) => {
                  const pickedDate = new Date(e.target.value + "T00:00:00");
                  const prevTime = values.datetime || new Date();
                  pickedDate.setHours(prevTime.getHours(), prevTime.getMinutes(), 0, 0);
                  setValues((v) => ({ ...v, datetime: pickedDate }));
                  setTouched((t) => ({ ...t, datetime: true }));
                }}
                onFocus={() => setFocusedField("date")}
                onBlur={() => setFocusedField(null)}
                className={`
                  w-full rounded-xl border text-center text-base font-semibold text-[#04193b]
                  transition-all duration-500 ease-in-out px-4 py-3 cursor-pointer
                  ${
                    focusedField === "date"
                      ? "border-[#04193b] ring-2 ring-[#04193b]"
                      : values.datetime
                      ? "border-[#04193b]"
                      : "border-gray-200 hover:shadow-md"
                  }
                `}
              />

              {/* Time Picker */}
              <select
                value={
                  values.datetime
                    ? `${values.datetime.getHours().toString().padStart(2, "0")}:${values.datetime
                        .getMinutes()
                        .toString()
                        .padStart(2, "0")}`
                    : ""
                }
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (!values.datetime) {
                    const today = new Date();
                    today.setHours(h, m, 0, 0);
                    setValues((v) => ({ ...v, datetime: today }));
                  } else {
                    const updated = new Date(values.datetime);
                    updated.setHours(h, m, 0, 0);
                    setValues((v) => ({ ...v, datetime: updated }));
                  }
                  setTouched?.((t) => ({ ...t, datetime: true }));
                }}
                onMouseDown={() => setFocusedField("time")}   // when dropdown opens
                onBlur={() => setFocusedField(null)}          // when dropdown closes
                className={`
                  w-full rounded-xl border text-center text-base font-semibold text-[#04193b]
                  transition-all duration-500 ease-in-out px-4 py-3 cursor-pointer
                  ${
                    focusedField === "time"
                      ? "border-[#04193b] ring-2 ring-[#04193b]"
                      : values.datetime
                      ? "border-[#04193b]"
                      : "border-gray-200 hover:shadow-md"
                  }
                `}
              >
                <option value="">Select time</option>
                {Array.from({ length: (22 - 6) * 4 + 1 }, (_, i) => {
                  const hour = 6 + Math.floor(i / 4);
                  const minute = (i % 4) * 15;
                  const label = new Date(0, 0, 0, hour, minute).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  });
                  const value = `${hour.toString().padStart(2, "0")}:${minute
                    .toString()
                    .padStart(2, "0")}`;
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>

            {touched.formSubmitted && errors.datetime && (
              <div className="text-red-500 text-sm mt-2">{errors.datetime}</div>
            )}

            {touched.formSubmitted && errors.datetimeInvalid && (
              <div className="text-red-500 text-sm mt-2">{errors.datetimeInvalid}</div>
            )}
          </div>


          {/* Address with Google Autocomplete */}
          {isLoaded && (
            <div
              className="mb-2"
              onMouseEnter={() => setActiveIndex(5)}
              onMouseLeave={() => setActiveIndex(null)}
            >
                            <PlacesAutocomplete
                value={values.address}
                onChange={(addr) => {
                  setValues((v) => ({ 
                    ...v, 
                    address: addr,
                    // Clear state and zipcode when user types (they'll be set again on selection)
                    state: "",
                    zipcode: ""
                  }));
                  // Reset address selected state and timezone when user types
                  setAddressSelected(false);
                  setJobTimezoneOffset(null);
                  // Clear address errors when user starts typing
                  if (errors.address) {
                    setErrors((errs) => {
                      const newErrs = { ...errs };
                      delete newErrs.address;
                      return newErrs;
                    });
                  }
                }}
                shouldFetchSuggestions={({ value }) => value.length > 2}
                onError={(status, clearSuggestions) => {
                  if (status === 'ZERO_RESULTS' && touched.address) {
                    setErrors((errs) => ({
                      ...errs,
                      address: "Please enter a valid US address.",
                    }));
                  }
                  clearSuggestions();
                }}
                onSelect={async (addr) => {
                   try {
                     const results = await geocodeByAddress(addr);
                     if (!results || !results.length) {
                       if (touched.address) {
                         setErrors((errs) => ({
                           ...errs,
                           address: "Please enter a valid US address.",
                         }));
                       }
                       setValues((v) => ({ ...v, address: "", state: "", zipcode: "" }));
                       setFilteredSuggestions([]);
                       setCurrentSuggestions([]);
                       setAddressSelected(false);
                       setJobTimezoneOffset(null);
                       return;
                     }
                     
                     const components = results[0]?.address_components || [];
                     const country = components.find((c) => c.types.includes("country"))?.short_name;
                     const state = components.find((c) => c.types.includes("administrative_area_level_1"))?.short_name;
                     const zipcode = components.find((c) => c.types.includes("postal_code"))?.long_name;

                     if (!country || country !== "US") {
                       setErrors((errs) => ({
                         ...errs,
                         address: "Please enter a valid United States address.",
                       }));
                       setValues((v) => ({ ...v, address: "", state: "", zipcode: "" }));
                       setFilteredSuggestions([]);
                       setCurrentSuggestions([]);
                       setAddressSelected(false);
                       setJobTimezoneOffset(null);
                       return;
                     }

                     // Check for state and zipcode
                     if (!state || !zipcode) {
                       setErrors((errs) => ({
                         ...errs,
                         address: "Please select an address that includes both state and zipcode.",
                       }));
                       setValues((v) => ({ ...v, address: "", state: "", zipcode: "" }));
                       setFilteredSuggestions([]);
                       setCurrentSuggestions([]);
                       setAddressSelected(false);
                       setJobTimezoneOffset(null);
                       return;
                     }
                     
                     // Clear any previous address errors
                     setErrors((errs) => {
                       const newErrs = { ...errs };
                       delete newErrs.address;
                       return newErrs;
                     });
                     
                     // valid US address with state and zipcode - store all components
                     setValues((v) => ({ 
                       ...v, 
                       address: results[0].formatted_address, // Use detailed geocoded address instead of autocomplete result
                       state: state,
                       zipcode: zipcode
                     }));
                     
                     // Get timezone for this address
                     const timezoneOffset = await getTimezoneFromAddress(addr);
                     setJobTimezoneOffset(timezoneOffset);
                     
                     // Clear suggestions to hide dropdown and mark address as selected
                     setFilteredSuggestions([]);
                     setCurrentSuggestions([]);
                     setAddressSelected(true);
                   } catch (err) {
                     // Handle ZERO_RESULTS and other geocoding errors gracefully
                     if (err.code === 'ZERO_RESULTS' || err.status === 'ZERO_RESULTS') {
                       setErrors((errs) => ({
                         ...errs,
                         address: "Please enter a valid US address.",
                       }));
                     } else {
                       setErrors((errs) => ({
                         ...errs,
                         address: "Unable to validate this address. Please try again.",
                       }));
                     }
                     setValues((v) => ({ ...v, address: "" }));
                   }
                 }}
                searchOptions={{ 
                  componentRestrictions: { country: ["us"] },
                  types: ['address'],
                  fields: ['address_components', 'formatted_address', 'geometry', 'place_id']
                }} // US suggestions only, prioritize addresses with postal codes
              >
                {({ getInputProps, suggestions, getSuggestionItemProps, loading }) => {
                  // Update current suggestions when they change (but not if user is actively typing or address is selected)
                  if (JSON.stringify(suggestions) !== JSON.stringify(currentSuggestions) && !loading && !addressSelected) {
                    setCurrentSuggestions(suggestions);
                  }
                  
                  // Use filtered suggestions if available, otherwise use original suggestions (but not if address is selected)
                  const displaySuggestions = addressSelected ? [] : (filteredSuggestions.length > 0 ? filteredSuggestions : suggestions);

                  return (
                    <div className="relative">
                      <label
                        htmlFor="address"
                        className="block text-sm font-semibold text-[#04193b]/80 mb-4"
                      >
                        Address
                      </label>

                      {/* Input field */}
                      <input
                        {...getInputProps({
                          placeholder: "",
                          id: "address",
                          name: "address",
                          className:
                            "w-full bg-transparent border border-gray-200 rounded-lg px-3 py-2 text-base font-normal text-[#04193b] transition-all",
                          onFocus: () => setActiveIndex(5),
                          onBlur: () => {
                            setActiveIndex(null);
                            setTouched((t) => ({ ...t, address: true }));
                          },
                        })}
                      />

                      {/* Underline animation */}
                      <span
                        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 h-0.5 bg-[#04193b] rounded ${
                          activeIndex === 5 ? "input-underline-animate" : "input-underline-reset"
                        }`}
                      />

                      {/* Suggestions dropdown */}
                      {loading && <div className="p-2 text-gray-500">Loading...</div>}
                      {displaySuggestions.map((suggestion, i) => {
                        const className = suggestion.active
                          ? "p-2 bg-[#a2d2ff] cursor-pointer"
                          : "p-2 cursor-pointer";
                        return (
                          <div
                            key={i}
                            {...getSuggestionItemProps(suggestion, { className })}
                          >
                            {suggestion.description}
                          </div>
                        );
                      })}
                      {!loading && suggestions.length > 0 && filteredSuggestions.length === 0 && (
                        <div className="p-2 text-gray-500 text-sm">
                          No complete addresses found. Please enter a more specific address with state and zipcode.
                        </div>
                      )}
                    </div>
                  );
                }}
              </PlacesAutocomplete>

                             {touched.address && errors.address && (
                               <div className="text-red-500 text-sm mt-2">{errors.address}</div>
                             )}

            </div>
          )}

{/* TOOLS SECTION - Uncomment if you want to offer tools as an add-on service
          <div className="mt-12">
            <label className="block text-sm font-semibold text-[#04193b]/80 mb-4">
              Do you need tools? (+$100)
            </label>
            <div className="grid grid-cols-2 gap-4">
              {["Yes", "No"].map((option) => (
                <div
                  key={option}
                  onClick={() =>
                    setValues((v) => ({
                      ...v,
                      tools: option === "Yes",
                      tools_description: option === "Yes" ? v.tools_description || "" : "",
                    }))
                  }
                  className={`flex items-center justify-center h-14 rounded-xl cursor-pointer border text-base font-semibold transition-all duration-500 ease-in-out ${
                    values.tools === (option === "Yes")
                      ? "border-[#04193b] ring-2 ring-[#04193b]"
                      : "border-gray-200 hover:shadow-md"
                  }`}
                >
                  {option}
                </div>
              ))}
            </div>

            {values.tools && (
              <div
                className="mt-6 mb-2"
                onMouseEnter={() => setActiveIndex(12)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <div className="relative">
                  <label
                    htmlFor="tools_description"
                    className="block text-sm font-semibold text-[#04193b]/80 mb-4"
                  >
                    What tools do you need?
                  </label>
                  <input
                    id="tools_description"
                    name="tools_description"
                    type="text"
                    value={values.tools_description || ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, tools_description: e.target.value }))
                    }
                    onFocus={() => setActiveIndex(12)}
                    onBlur={() => setActiveIndex(null)}
                    className="w-full bg-transparent border border-gray-200 rounded-lg px-3 py-2 text-base font-normal text-[#04193b] transition-all"
                    placeholder="e.g. dolly, power drill..."
                  />
                  <span
                    className={`pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 h-0.5 bg-[#04193b] rounded ${
                      activeIndex === 12
                        ? "input-underline-animate"
                        : "input-underline-reset"
                    }`}
                  />
                </div>
              </div>
            )}
          </div>

*/}
                    {/* Notes */}
          <div className="mb-2"
onMouseEnter={() => setActiveIndex(6)}
              onMouseLeave={() => setActiveIndex(null)}>
            <div className="relative">
              <label htmlFor="notes" className="block text-sm font-semibold text-[#04193b]/80 mb-4">
                Notes for the Workers
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                maxLength={120}
                value={values.notes}
                onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
                onFocus={() => setActiveIndex(6)}
                onBlur={() => {
                  setActiveIndex(null);
                  setTouched((t) => ({ ...t, notes: true }));
                }}
                className={`w-full bg-transparent border border-gray-200 rounded-lg px-3 py-2 text-base font-normal text-[#04193b] transition-all resize-none textarea-underline ${
                  activeIndex === 6 ? "textarea-underline-active" : "textarea-underline-reset"
                }`}
                placeholder="e.g. painting job, 2 fences, bring clothes you don't mind getting paint on..."
              />
            </div>
            <div className="text-right text-sm text-gray-500 mt-1">{values.notes?.length || 0}/120</div>
            {touched.notes && errors.notes && (
              <div className="text-red-500 text-sm mt-2">{errors.notes}</div>
            )}
          </div>

          {/* Coupon Code Section 
          <div className="mt-12">
            <label className="block text-sm font-semibold text-[#04193b]/80 mb-4">
              Coupon Code (Optional)
            </label>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={values.coupon_code || ""}
                  onChange={(e) => {
                    const code = e.target.value.toUpperCase();
                    setValues((v) => ({ ...v, coupon_code: code }));
                    // Clear validation state when user changes the code
                    if (couponValid !== null) {
                      setCouponValid(null);
                      setCouponDiscount(0);
                      setCouponDiscountType(null);
                      setCouponPercentOff(null);
                    }
                  }}
                  placeholder="Enter coupon code"
                  className="w-full bg-transparent border border-gray-200 rounded-lg px-3 py-2 text-base font-normal text-[#04193b] transition-all"
                />
                {validatingCoupon && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#04193b]"></div>
                  </div>
                )}
                {couponValid === true && !validatingCoupon && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                {couponValid === false && !validatingCoupon && values.coupon_code?.trim() && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-red-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleApplyCoupon}
                disabled={validatingCoupon || !values.coupon_code?.trim()}
                className="px-6 py-2 rounded-lg font-semibold text-base bg-[#04193b] text-white hover:bg-[#a2d2ff] hover:text-[#04193b] border border-transparent transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {validatingCoupon ? "Applying..." : "Apply"}
              </button>
            </div>
            {couponValid === false && !validatingCoupon && values.coupon_code?.trim() && (
              <div className="text-red-500 text-sm mt-2">Invalid coupon code. Please check and try again.</div>
            )}
            {couponValid === true && !validatingCoupon && (
              <div className="text-green-600 text-sm mt-2">Coupon applied! Discount will be shown in the cost breakdown below.</div>
            )}
          </div>
          */}

          {/* Minimal Cost Estimate */}
          <CostBreakdown 
            values={values} 
            discountAmount={couponDiscount}
            discountType={couponDiscountType}
            percentOff={couponPercentOff}
            couponCode={couponValid === true ? values.coupon_code?.trim() : null}
          />
        </form>

        {/* Stripe Elements wrapper - always show payment form */}

        <div className="mt-12 w-full">

          {clientSecret ? (
            <Elements
              stripe={stripePromise}
              options={{ 
                clientSecret,
                appearance: { 
                  theme: "flat",
                  variables: {
                    colorPrimary: '#04193b',
                    colorBackground: '#ffffff',
                    colorText: '#04193b',
                    colorDanger: '#ef4444',
                    fontFamily: "'Inter', sans-serif",
                    spacingUnit: '4px',
                    borderRadius: '8px',
                  }
                }
              }}
              key={clientSecret}
            >
              <div className="space-y-8">
                {/* Payment Error Message */}
                {paymentError && (
                  <div className="text-red-500 text-sm text-center p-3 bg-red-50 rounded-lg border border-red-200">
                    {paymentError}
                  </div>
                )}

                {/* PaymentElement */}
                <div className="mb-2">
                  <div className="relative">
                    <label className="block text-sm font-semibold text-[#04193b]/80 mb-4">
                      Payment Information
                    </label>
                    <div className="w-full bg-transparent border border-gray-200 rounded-lg px-3 py-2 text-base font-normal text-[#04193b] transition-all">
                      <PaymentElement
                        options={{
                          layout: 'tabs'
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Submit */}
                <PaymentSubmitButton
                  values={values}
                  validate={validate}
                  onBooked={handleBooked}
                  setTouched={setTouched}
                  setErrors={setErrors}
                  clientSecret={clientSecret}
                  jobTimezoneOffset={jobTimezoneOffset}
                  isSameDayJob={isSameDayJob}
                  setPaymentError={setPaymentError}
                  discountAmount={couponDiscount}
                  discountType={couponDiscountType}
                  percentOff={couponPercentOff}
                  couponValid={couponValid}
                />
              </div>
            </Elements>
          ) : (
            <p className="text-gray-500">
              {!values.first_name || !values.last_name || !isValidEmail(values.email)
                ? ""
                : "Loading secure payment form…"}
            </p>
          )}
        </div>

        {/* Terms of Service and Privacy Policy Checkbox */}
        <div className="mt-8 max-w-2xl mx-auto">
          <div className="flex items-start justify-center space-x-3">
            <input
              type="checkbox"
              id="terms_accepted"
              name="terms_accepted"
              checked={values.terms_accepted}
              onChange={(e) => {
                setValues((v) => ({ ...v, terms_accepted: e.target.checked }));
                setTouched((t) => ({ ...t, terms_accepted: true }));
              }}
              className="mt-1 h-4 w-4 text-[#04193b] border-gray-300 rounded focus:ring-[#04193b] focus:ring-2"
            />
            <label htmlFor="terms_accepted" className="text-sm text-gray-600 leading-relaxed">
              Click here to agree to{" "}
              <a 
                href="https://greatamericanlabor.com/terms-of-service" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[#04193b] hover:text-[#a2d2ff] underline transition-colors"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a 
                href="https://greatamericanlabor.com/privacy" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[#04193b] hover:text-[#a2d2ff] underline transition-colors"
              >
                Privacy Policy
              </a>
              .
            </label>
          </div>
          {touched.terms_accepted && errors.terms_accepted && (
            <div className="text-red-500 text-sm mt-2 text-center">{errors.terms_accepted}</div>
          )}
        </div>

          </>
        )}
      </div>
    </div>
  );
}
