#!/usr/bin/env python3
"""
Attendance App Backend API
=========================
Flask server exposing endpoints to parse HTML attendance data,
fetch dynamic reports from ksps.co.id with user session cookies,
and write attendance records back to the Excel template.
"""

import os
import sys
import tempfile
import logging
from flask import Flask, request, jsonify, send_file
import requests
from bs4 import BeautifulSoup

# Ensure current directory is in python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from process_absen import parse_html, write_to_excel, AttendanceRecord
except ImportError as e:
    logging.error("Failed to import process_absen. Make sure process_absen.py exists in the workspace. Error: %s", e)
    raise

# ---------------------------------------------------------------------------
# Logging Setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

# Find paths for static folder (React build output)
base_dir = os.path.dirname(os.path.abspath(__file__))
static_folder = os.path.join(base_dir, "frontend", "dist")
app = Flask(__name__, static_folder=static_folder, static_url_path="/")

# Template Excel file path helper
def get_template_path():
    custom_template = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template_custom.xlsx")
    if os.path.isfile(custom_template):
        return custom_template
    default_template = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template_absen.xlsx")
    if os.path.isfile(default_template):
        return default_template
    full_template = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template-full-absensi.xlsx")
    if os.path.isfile(full_template):
        return full_template
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "template-table-absen.xlsx")


# ---------------------------------------------------------------------------
# CORS Configuration (Custom implementation)
# ---------------------------------------------------------------------------
@app.after_request
def after_request(response):
    response.headers.add("Access-Control-Allow-Origin", "*")
    response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
    response.headers.add("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
    return response

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
def serialize_records(records, year, month):
    """Serialize AttendanceRecord list into JSON-serializable list of dicts."""
    serialized = []
    for r in records:
        serialized.append({
            "tgl": r.tgl,
            "masuk": r.masuk,
            "pulang": r.pulang,
            "keterangan": r.keterangan,
            "is_holiday_or_leave": r.is_holiday_or_leave,
            "has_attendance": r.has_attendance
        })
    return {
        "year": year,
        "month": month,
        "records": serialized
    }

import json

def get_stored_device_tokens():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "device_tokens.json")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_device_token(username, token):
    if not username:
        return
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "device_tokens.json")
    tokens = get_stored_device_tokens()
    tokens[str(username)] = token
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(tokens, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save device tokens: {e}")

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.route("/api/health", methods=["GET"])
def health():
    """Verify backend status."""
    template_path = get_template_path()
    template_exists = os.path.isfile(template_path)
    
    import shutil
    soffice_path = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    has_libreoffice = os.path.exists(soffice_path) or shutil.which("soffice") is not None
    
    return jsonify({
        "status": "healthy",
        "template_found": template_exists,
        "template_path": template_path,
        "pdf_supported": has_libreoffice
    })

@app.route("/api/login", methods=["POST"])
def login_endpoint():
    """Authenticate with ksps.co.id and retrieve the session cookies."""
    data = request.json or {}
    username = data.get("username")
    password = data.get("password")
    
    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400
        
    login_url = "https://ksps.co.id/eksternal/site/login"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        session = requests.Session()
        # Step 1: GET the login page to retrieve the CSRF token
        logger.info("Fetching login page to extract CSRF token...")
        get_res = session.get(login_url, headers=headers, timeout=15)
        
        if get_res.status_code != 200:
            return jsonify({"error": f"Failed to load login page: HTTP {get_res.status_code}"}), get_res.status_code
            
        soup = BeautifulSoup(get_res.text, "html.parser")
        
        # In Yii2, CSRF token is in a meta tag: <meta name="csrf-token" content="...">
        csrf_meta = soup.find("meta", {"name": "csrf-token"})
        csrf_token = csrf_meta["content"] if csrf_meta else None
        
        # Alternate fallback: hidden form inputs
        if not csrf_token:
            csrf_input = soup.find("input", {"name": "_csrf-absen-bisnis"})
            csrf_token = csrf_input["value"] if csrf_input else None
            
        if not csrf_token:
            logger.warning("CSRF token not found, trying without it.")
            csrf_token = ""
            
        logger.info("Successfully retrieved CSRF token.")
        
        # Step 2: POST credentials to authenticate
        login_data = {
            "_csrf-absen-bisnis": csrf_token,
            "LoginForm[username]": username,
            "LoginForm[password]": password,
            "LoginForm[rememberMe]": "1"
        }
        
        logger.info(f"Submitting credentials to login endpoint for user: {username}")
        post_res = session.post(login_url, data=login_data, headers=headers, timeout=20, allow_redirects=False)
        
        cookie_dict = session.cookies.get_dict()
        logger.info(f"Response status: {post_res.status_code}, Cookies retrieved: {list(cookie_dict.keys())}")
        
        is_success = False
        if post_res.status_code in (302, 301):
            is_success = True
        elif "_identity-absen-bisnis" in cookie_dict or "PHPSESSID" in cookie_dict:
            if "login-form" not in post_res.text and "LoginForm" not in post_res.text:
                is_success = True
                
        if not is_success:
            return jsonify({
                "error": "Authentication failed. Please verify your username and password, or check if the KSPS server is accessible."
            }), 401
            
        # Serialize all cookies in the session into a cookie header string format: "name=value; name2=value2"
        cookie_list = [f"{name}={val}" for name, val in cookie_dict.items()]
        session_cookie_str = "; ".join(cookie_list)
        
        display_name = username
        try:
            home_res = session.get("https://ksps.co.id/eksternal/", headers=headers, timeout=10)
            if home_res.status_code == 200:
                home_soup = BeautifulSoup(home_res.text, "html.parser")
                logout_btn = home_soup.find("button", class_="logout")
                if logout_btn:
                    btn_text = logout_btn.get_text()
                    if "Logout (" in btn_text:
                        display_name = btn_text.split("Logout (")[1].replace(")", "").strip()
        except Exception as e:
            logger.warning(f"Could not fetch profile display name: {e}")
            
        stored_tokens = get_stored_device_tokens()
        device_token = stored_tokens.get(str(username), "")
        
        return jsonify({
            "status": "success",
            "message": "Login successful",
            "display_name": display_name,
            "session_cookie": session_cookie_str,
            "username": username,
            "device_token": device_token
        })
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error during login request: {e}")
        return jsonify({"error": f"Failed to connect to ksps.co.id: {str(e)}"}), 502
    except Exception as e:
        logger.error(f"Unexpected error in login: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected login error occurred: {str(e)}"}), 500

@app.route("/api/remote-absen", methods=["POST"])
def remote_absen_endpoint():
    """Submit remote check-in/check-out to ksps.co.id using active session cookie and coordinates."""
    data = request.json or {}
    session_cookie = data.get("session_cookie")
    latitude = data.get("latitude", "-7.7837217165")
    longitude = data.get("longitude", "110.4329516476")
    status = data.get("status", "0")
    device_token = data.get("device_token", "")
    
    if not session_cookie:
        return jsonify({"error": "Session cookie is required"}), 400
        
    remote_url = "https://ksps.co.id/eksternal/absen/remote"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # Parse cookie string into a dict
    cookies = {}
    for item in session_cookie.split(";"):
        if "=" in item:
            k, v = item.strip().split("=", 1)
            cookies[k] = v
            
    try:
        session = requests.Session()
        # Set cookies in session
        for k, v in cookies.items():
            session.cookies.set(k, v, domain="ksps.co.id")
            
        # Step 1: GET the remote page to retrieve a fresh CSRF token
        logger.info("Fetching remote page to retrieve CSRF token...")
        get_res = session.get(remote_url, headers=headers, timeout=15)
        
        if get_res.status_code != 200:
            return jsonify({"error": f"Failed to load remote page: HTTP {get_res.status_code}"}), get_res.status_code
            
        soup = BeautifulSoup(get_res.text, "html.parser")
        
        # Enforce administrative access control: only WIBI CHAMIM MUSHODIQ is authorized
        logout_btn = soup.find("button", class_="logout")
        is_authorized = False
        if logout_btn:
            btn_text = logout_btn.get_text()
            if "WIBI CHAMIM MUSHODIQ" in btn_text:
                is_authorized = True
                
        if not is_authorized:
            try:
                test_res = session.get("https://ksps.co.id/eksternal/", headers=headers, timeout=10)
                if test_res.status_code == 200:
                    test_soup = BeautifulSoup(test_res.text, "html.parser")
                    test_btn = test_soup.find("button", class_="logout")
                    if test_btn and "WIBI CHAMIM MUSHODIQ" in test_btn.get_text():
                        is_authorized = True
            except Exception:
                pass
                
        if not is_authorized:
            logger.warning("Unauthorized user attempted remote punch.")
            return jsonify({"error": "Akses ditolak. Fitur ini hanya untuk pengguna terotorisasi."}), 403
        
        # Log forms and input fields for diagnostic purposes
        forms = soup.find_all("form")
        logger.info(f"Found {len(forms)} forms on remote page.")
        for idx, f in enumerate(forms):
            logger.info(f"Form {idx}: action={f.get('action')}, method={f.get('method')}")
            for ipt in f.find_all(["input", "select", "textarea"]):
                logger.info(f"  Input: name={ipt.get('name')}, type={ipt.get('type')}, value={ipt.get('value')}")
        
        # Extract CSRF token from page
        csrf_meta = soup.find("meta", {"name": "csrf-token"})
        csrf_token = csrf_meta["content"] if csrf_meta else None
        
        if not csrf_token:
            csrf_input = soup.find("input", {"name": "_csrf-absen-bisnis"})
            csrf_token = csrf_input["value"] if csrf_input else None
            
        if not csrf_token:
            csrf_token = cookies.get("_csrf-absen-bisnis", "")
            
        logger.info(f"Retrieved CSRF token for remote attendance: {csrf_token[:10]}...")
        
        # Step 2: POST the form data to the remote endpoint
        post_data = {
            "_csrf-absen-bisnis": csrf_token,
            "Absen[lintang]": latitude,
            "Absen[bujur]": longitude,
            "Absen[token]": str(device_token),
            "Absen[status]": str(status)
        }
        
        logger.info(f"Submitting remote attendance: status={status}, lat={latitude}, lng={longitude}, token={device_token}")
        post_res = session.post(remote_url, data=post_data, headers=headers, timeout=15)
        logger.info(f"POST response status: {post_res.status_code}")
        
        # Save response HTML for diagnostics
        if post_res.status_code == 200:
            error_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "remote_response_error.html")
            try:
                with open(error_file_path, "w", encoding="utf-8") as f:
                    f.write(post_res.text)
                logger.info(f"Saved remote response HTML for diagnostics to: {error_file_path}")
            except Exception as ex:
                logger.error(f"Failed to save diagnostic HTML file: {ex}")
        
        # Parse the response page for errors
        post_soup = BeautifulSoup(post_res.text, "html.parser")
        alert_success = post_soup.find("div", class_="alert-success")
        alert_danger = post_soup.find("div", class_="alert-danger")
        alert_warning = post_soup.find("div", class_="alert-warning")
        
        error_msg = ""
        success_msg = ""
        
        # Parse activeform/validation errors
        yii_errors = []
        for error_div in post_soup.find_all(class_=["help-block", "help-block-error", "invalid-feedback"]):
            txt = error_div.get_text(strip=True)
            if txt:
                yii_errors.append(txt)
        # Search for form group error states
        for fg in post_soup.find_all(class_="has-error"):
            lbl = fg.find("label")
            lbl_txt = lbl.get_text(strip=True) if lbl else ""
            help_blk = fg.find(class_=["help-block", "help-block-error"])
            help_txt = help_blk.get_text(strip=True) if help_blk else ""
            if help_txt:
                yii_errors.append(f"{lbl_txt}: {help_txt}" if lbl_txt else help_txt)
                
        if yii_errors:
            error_msg = " | ".join(set(yii_errors))
            logger.warning(f"Yii2 validation errors extracted: {error_msg}")
        
        if alert_success:
            btn = alert_success.find("button", class_="close")
            if btn:
                btn.decompose()
            success_msg = alert_success.get_text(strip=True)
        if alert_danger:
            btn = alert_danger.find("button", class_="close")
            if btn:
                btn.decompose()
            error_msg = alert_danger.get_text(strip=True)
        elif alert_warning:
            btn = alert_warning.find("button", class_="close")
            if btn:
                btn.decompose()
            error_msg = alert_warning.get_text(strip=True)
            
        # Check URL redirection to verify success or failure
        if "/absen/index" in post_res.url:
            success_msg = success_msg or "Absensi remote berhasil dilakukan."
        elif "/absen/remote" in post_res.url:
            if not error_msg:
                # If we stayed on the remote form page and no error was parsed, it's a failure
                error_msg = "Absensi remote gagal. Halaman form dimuat kembali (kemungkinan parameter atau batas waktu salah)."
        else:
            # Any other page redirection or no redirect
            if not error_msg and not success_msg:
                success_msg = "Absensi remote dikirim."
                
        if post_res.status_code != 200:
            error_msg = error_msg or f"HTTP Error {post_res.status_code} saat mengirim absensi."
            
        if error_msg:
            return jsonify({"status": "error", "message": error_msg}), 400
        else:
            return jsonify({"status": "success", "message": success_msg or "Absensi remote berhasil."})
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error during remote attendance request: {e}")
        return jsonify({"error": f"Failed to connect to ksps.co.id: {str(e)}"}), 502
    except Exception as e:
        logger.error(f"Error performing remote attendance: {e}", exc_info=True)
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500



@app.route("/api/get-device-token", methods=["GET"])
def get_device_token_endpoint():
    """Retrieve the stored device token for a given username or fallback to the first available."""
    username = request.args.get("username")
    tokens = get_stored_device_tokens()
    
    token = ""
    if username and str(username) in tokens:
        token = tokens[str(username)]
    elif tokens:
        token = list(tokens.values())[0]
        
    return jsonify({
        "status": "success",
        "device_token": token
    })

@app.route("/api/save-device-token", methods=["POST"])
def save_device_token_endpoint():
    """Save/update the device token on the server for a specific username."""
    data = request.json or {}
    username = data.get("username")
    device_token = data.get("device_token", "")
    
    if not username:
        return jsonify({"error": "Username is required"}), 400
        
    save_device_token(username, device_token)
    return jsonify({"status": "success", "message": "Device token saved on server."})

@app.route("/api/parse-html-file", methods=["POST"])
def parse_html_file_endpoint():
    """Accept an HTML file upload and parse its attendance table."""
    if "file" not in request.files:
        return jsonify({"error": "No file part in the request"}), 400
    
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400
    
    try:
        # Create a temp file to store uploaded contents
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as temp_html:
            file.save(temp_html.name)
            temp_path = temp_html.name
        
        logger.info(f"Parsing uploaded file saved temporarily at: {temp_path}")
        records, year, month = parse_html(temp_path)
        
        # Clean up temp file
        os.remove(temp_path)
        
        return jsonify(serialize_records(records, year, month))
        
    except ValueError as e:
        logger.error(f"Validation/parsing error: {e}")
        return jsonify({"error": f"Failed to parse attendance table: {str(e)}"}), 400
    except Exception as e:
        logger.error(f"Unexpected error during upload parsing: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500

@app.route("/api/fetch-html-url", methods=["POST"])
def fetch_html_url_endpoint():
    """Fetch monthly attendance HTML from ksps.co.id and parse it."""
    data = request.json or {}
    month = data.get("month")  # YYYY-MM
    session_cookie = data.get("session_cookie", "").strip()
    
    if not month:
        return jsonify({"error": "Month parameter (YYYY-MM) is required"}), 400
    
    # Construct external URL
    target_url = f"https://ksps.co.id/eksternal/absen/index?Absen%5Btanggal%5D={month}"
    logger.info(f"Proxying request to URL: {target_url}")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    if session_cookie:
        headers["Cookie"] = session_cookie
    
    try:
        # Fetch the webpage
        response = requests.get(target_url, headers=headers, timeout=20)
        
        if response.status_code != 200:
            return jsonify({"error": f"KSPS server returned status code {response.status_code}"}), response.status_code
        
        html_content = response.text
        
        # Check if login is required (if we got redirected or if page is a login screen)
        if "login" in response.url.lower() or 'id="login-form"' in html_content or "LoginForm" in html_content:
            logger.warning("Session appears to be unauthenticated or cookie expired.")
            return jsonify({
                "error": "Authentication required. Please provide a valid, active session cookie from ksps.co.id."
            }), 401
            
        # Ensure we actually retrieved an attendance page/table
        if "<table" not in html_content:
            return jsonify({
                "error": "Could not locate attendance table. Make sure your session cookie is correct."
            }), 400

        # Save HTML locally to temp file to reuse process_absen.py parsing logic
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as temp_html:
            temp_html.write(html_content.encode("utf-8"))
            temp_path = temp_html.name
            
        logger.info(f"Parsing fetched HTML saved temporarily at: {temp_path}")
        records, year, month = parse_html(temp_path)
        
        # Clean up temp file
        os.remove(temp_path)
        
        return jsonify(serialize_records(records, year, month))
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error fetching from KSPS: {e}")
        return jsonify({"error": f"Failed to connect to ksps.co.id: {str(e)}"}), 502
    except ValueError as e:
        logger.error(f"Parsing error from fetched HTML: {e}")
        return jsonify({"error": f"Failed to parse attendance table: {str(e)}"}), 400
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500

@app.route("/api/generate-xlsx", methods=["POST"])
def generate_xlsx_endpoint():
    """Accept attendance JSON, fill the template, and return downloadable Excel file."""
    data = request.json or {}
    records_data = data.get("records")
    year = data.get("year")
    month = data.get("month")
    
    custom_template_b64 = data.get("custom_template")
    if custom_template_b64:
        try:
            import base64
            import io
            if "," in custom_template_b64:
                custom_template_b64 = custom_template_b64.split(",")[1]
            template_bytes = base64.b64decode(custom_template_b64)
            template_input = io.BytesIO(template_bytes)
        except Exception as e:
            logger.error(f"Failed to decode custom template: {e}")
            return jsonify({"error": f"Invalid custom template base64: {str(e)}"}), 400
    else:
        template_path = get_template_path()
        if not os.path.isfile(template_path):
            logger.error(f"Template not found at: {template_path}")
            return jsonify({"error": "Excel template file is missing on the server."}), 500
        template_input = template_path

    try:
        # Convert JSON records list to AttendanceRecord list
        records = []
        for r in records_data:
            records.append(AttendanceRecord(
                tgl=int(r["tgl"]),
                masuk=r.get("masuk"),
                pulang=r.get("pulang"),
                keterangan=r.get("keterangan")
            ))
            
        # Create temp file for writing Excel
        fd, temp_xlsx_path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd) # Close file descriptor so openpyxl can write
        
        logger.info(f"Generating Excel file at temp path: {temp_xlsx_path}")
        write_to_excel(
            records=records,
            template_path=template_input,
            output_path=temp_xlsx_path,
            year=int(year),
            month=int(month)
        )
        
        # Prepare file name for download header
        filename = f"Absen_Bulan_{month:02d}_{year}.xlsx"
        
        # Send file response
        res = send_file(
            temp_xlsx_path,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=filename
        )
        
        # We need to register a callback to clean up the temp file after the response is sent
        @res.call_on_close
        def cleanup_temp_file():
            try:
                if os.path.exists(temp_xlsx_path):
                    os.remove(temp_xlsx_path)
                    logger.info(f"Cleaned up temp Excel file: {temp_xlsx_path}")
            except Exception as ex:
                logger.error(f"Error cleaning up temp Excel file: {ex}")
                
        return res
        
    except Exception as e:
        logger.error(f"Error generating Excel file: {e}", exc_info=True)
        return jsonify({"error": f"Failed to generate Excel file: {str(e)}"}), 500

@app.route("/api/download-template", methods=["GET"])
def download_template():
    """Download the current default or active template file."""
    default_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template_absen.xlsx")
    full_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template-full-absensi.xlsx")
    table_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template-table-absen.xlsx")
    
    target = None
    if os.path.isfile(default_path):
        target = default_path
    elif os.path.isfile(full_path):
        target = full_path
    elif os.path.isfile(table_path):
        target = table_path
        
    if not target:
        return jsonify({"error": "No template files found on the server."}), 404
        
    return send_file(
        target,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="template_absen.xlsx"
    )

@app.route("/api/upload-template", methods=["POST"])
def upload_template():
    """Upload a custom template to replace the default template."""
    if "file" not in request.files:
        return jsonify({"error": "No file part in the request"}), 400
        
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400
        
    if not file.filename.lower().endswith(".xlsx"):
        return jsonify({"error": "Only .xlsx files are supported"}), 400
        
    try:
        fd, temp_path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd)
        file.save(temp_path)
        
        # Validate that it is a valid openpyxl workbook
        import openpyxl
        try:
            wb = openpyxl.load_workbook(temp_path, read_only=True)
            wb.close()
        except Exception as ve:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            logger.error(f"Uploaded file is not a valid Excel file: {ve}")
            return jsonify({"error": "Uploaded file is not a valid Excel (.xlsx) file."}), 400
            
        # Copy to custom template path
        custom_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template_custom.xlsx")
        if os.path.exists(custom_path):
            os.remove(custom_path)
            
        import shutil
        shutil.move(temp_path, custom_path)
        logger.info(f"Custom template uploaded and saved to: {custom_path}")
        
        return jsonify({
            "status": "success",
            "message": "Template uploaded successfully",
            "active_template": "template_custom.xlsx"
        })
    except Exception as e:
        logger.error(f"Error handling template upload: {e}", exc_info=True)
        return jsonify({"error": f"Failed to upload template: {str(e)}"}), 500

@app.route("/api/reset-template", methods=["POST"])
def reset_template():
    """Remove custom template and revert to default."""
    custom_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template_custom.xlsx")
    if os.path.isfile(custom_path):
        try:
            os.remove(custom_path)
            logger.info("Custom template removed, reverted to default template.")
            return jsonify({
                "status": "success",
                "message": "Template reset to default successfully."
            })
        except Exception as e:
            logger.error(f"Error deleting custom template: {e}")
            return jsonify({"error": f"Failed to delete custom template: {str(e)}"}), 500
    else:
        return jsonify({
            "status": "success",
            "message": "Already using default template."
        })

@app.route("/api/template-status", methods=["GET"])
def template_status():
    """Get the current template status (active template, whether it is custom, etc.)."""
    custom_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template_custom.xlsx")
    default_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template_absen.xlsx")
    full_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template-full-absensi.xlsx")
    table_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template-table-absen.xlsx")
    
    is_custom = os.path.isfile(custom_path)
    active_path = get_template_path()
    active_name = os.path.basename(active_path)
    
    available_templates = []
    if os.path.isfile(custom_path): available_templates.append("template_custom.xlsx")
    if os.path.isfile(default_path): available_templates.append("template_absen.xlsx")
    if os.path.isfile(full_path): available_templates.append("template-full-absensi.xlsx")
    if os.path.isfile(table_path): available_templates.append("template-table-absen.xlsx")
    
    return jsonify({
        "is_custom": is_custom,
        "active_template": active_name,
        "available_templates": available_templates
    })

@app.route("/api/preview", methods=["POST"])
def preview_endpoint():
    """Accept attendance JSON, fill the template, and return HTML representation for preview."""
    data = request.json or {}
    records_data = data.get("records")
    year = data.get("year")
    month = data.get("month")
    
    custom_template_b64 = data.get("custom_template")
    if custom_template_b64:
        try:
            import base64
            import io
            if "," in custom_template_b64:
                custom_template_b64 = custom_template_b64.split(",")[1]
            template_bytes = base64.b64decode(custom_template_b64)
            template_input = io.BytesIO(template_bytes)
        except Exception as e:
            logger.error(f"Failed to decode custom template: {e}")
            return jsonify({"error": f"Invalid custom template base64: {str(e)}"}), 400
    else:
        template_path = get_template_path()
        if not os.path.isfile(template_path):
            return jsonify({"error": "Excel template file is missing on the server."}), 500
        template_input = template_path

    try:
        # Convert JSON records list to AttendanceRecord list
        records = []
        for r in records_data:
            records.append(AttendanceRecord(
                tgl=int(r["tgl"]),
                masuk=r.get("masuk"),
                pulang=r.get("pulang"),
                keterangan=r.get("keterangan")
            ))
            
        # Create temp file for writing Excel
        fd, temp_xlsx_path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd)
        
        # Write Excel
        write_to_excel(
            records=records,
            template_path=template_input,
            output_path=temp_xlsx_path,
            year=int(year),
            month=int(month)
        )
        
        # Convert Excel to HTML using xlsx2html
        import io
        try:
            from xlsx2html import xlsx2html
        except ImportError:
            if os.path.exists(temp_xlsx_path):
                os.remove(temp_xlsx_path)
            return jsonify({
                "error": "The 'xlsx2html' package is not installed on the server. Please run 'pip install xlsx2html' to enable spreadsheet previews."
            }), 500

        html_io = io.StringIO()
        xlsx2html(temp_xlsx_path, html_io)
        html_content = html_io.getvalue()
        
        # Clean up temp Excel file
        if os.path.exists(temp_xlsx_path):
            os.remove(temp_xlsx_path)
            
        return jsonify({
            "status": "success",
            "html": html_content
        })
        
    except Exception as e:
        logger.error(f"Error generating preview: {e}", exc_info=True)
        return jsonify({"error": f"Failed to generate preview: {str(e)}"}), 500

@app.route("/api/generate-pdf", methods=["POST"])
def generate_pdf_endpoint():
    """Accept attendance JSON, fill the template, convert to PDF using LibreOffice, and return PDF file."""
    data = request.json or {}
    records_data = data.get("records")
    year = data.get("year")
    month = data.get("month")
    
    custom_template_b64 = data.get("custom_template")
    if custom_template_b64:
        try:
            import base64
            import io
            if "," in custom_template_b64:
                custom_template_b64 = custom_template_b64.split(",")[1]
            template_bytes = base64.b64decode(custom_template_b64)
            template_input = io.BytesIO(template_bytes)
        except Exception as e:
            logger.error(f"Failed to decode custom template: {e}")
            return jsonify({"error": f"Invalid custom template base64: {str(e)}"}), 400
    else:
        template_path = get_template_path()
        if not os.path.isfile(template_path):
            return jsonify({"error": "Excel template file is missing on the server."}), 500
        template_input = template_path

    import shutil
    import subprocess
    
    # Locate LibreOffice soffice
    soffice_path = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    if not os.path.exists(soffice_path):
        soffice_path = shutil.which("soffice")
        
    if not soffice_path:
        return jsonify({
            "error": "LibreOffice is not installed on the server. To download PDFs directly, please install LibreOffice (e.g. 'brew install --cask libreoffice') or use the browser's native 'Print to PDF' option in the Preview window."
        }), 400

    try:
        # Convert JSON records list to AttendanceRecord list
        records = []
        for r in records_data:
            records.append(AttendanceRecord(
                tgl=int(r["tgl"]),
                masuk=r.get("masuk"),
                pulang=r.get("pulang"),
                keterangan=r.get("keterangan")
            ))
            
        # Create temp folder for conversion to avoid filename collisions
        temp_dir = tempfile.mkdtemp()
        temp_xlsx_path = os.path.join(temp_dir, f"Absen_Bulan_{month:02d}_{year}.xlsx")
        
        # Write Excel
        write_to_excel(
            records=records,
            template_path=template_input,
            output_path=temp_xlsx_path,
            year=int(year),
            month=int(month)
        )
        
        logger.info(f"Converting Excel to PDF using LibreOffice: {temp_xlsx_path}")
        # Run LibreOffice headless conversion
        proc = subprocess.run([
            soffice_path,
            "--headless",
            "--convert-to", "pdf",
            temp_xlsx_path,
            "--outdir", temp_dir
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        
        expected_pdf_path = os.path.join(temp_dir, f"Absen_Bulan_{month:02d}_{year}.pdf")
        
        if proc.returncode != 0 or not os.path.isfile(expected_pdf_path):
            logger.error(f"LibreOffice conversion failed: code={proc.returncode}, stdout={proc.stdout}, stderr={proc.stderr}")
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
            return jsonify({"error": "Failed to convert Excel to PDF using LibreOffice."}), 500
            
        # Prepare file name for download header
        filename = f"Absen_Bulan_{month:02d}_{year}.pdf"
        
        # Send file response
        res = send_file(
            expected_pdf_path,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename
        )
        
        # Register cleanup to delete temp folder after response is sent
        @res.call_on_close
        def cleanup_temp_dir():
            try:
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)
                    logger.info(f"Cleaned up temp PDF conversion folder: {temp_dir}")
            except Exception as ex:
                logger.error(f"Error cleaning up temp PDF folder: {ex}")
                
        return res
        
    except Exception as e:
        logger.error(f"Error generating PDF file: {e}", exc_info=True)
        return jsonify({"error": f"Failed to generate PDF: {str(e)}"}), 500

from flask import send_from_directory

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve(path):
    if path != "" and os.path.exists(app.static_folder + "/" + path):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, "index.html")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    logger.info(f"Starting Flask server on port {port}...")
    app.run(host="127.0.0.1", port=port, debug=True)
