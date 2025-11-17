#!/bin/bash

# Camping Booking API Poller
# Polls Reserve America API endpoints every second

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Trap Ctrl+C for clean exit
trap cleanup INT

cleanup() {
    echo ""
    echo -e "${YELLOW}⏹️  Stopping... Killing all background requests...${NC}"
    # Kill all child processes (suppress bash termination messages)
    pkill -P $$ 2>/dev/null
    sleep 0.5
    echo -e "${YELLOW}👋 Polling stopped. Goodbye!${NC}"
    exit 0
}

# Print header
clear
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║        🏕️  Reserve America API Poller                      ║${NC}"
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo ""

# Function to URL decode a string
url_decode() {
    local url_encoded="${1//+/ }"
    printf '%b' "${url_encoded//%/\\x}"
}

# Check if required files exist
missing_files=false

if [ ! -f ".jwt_token" ]; then
    echo -e "${YELLOW}⚠️  No .jwt_token file found${NC}"
    touch .jwt_token
    missing_files=true
fi

if [ ! -f ".a1data" ]; then
    echo -e "${YELLOW}⚠️  No .a1data file found${NC}"
    touch .a1data
    missing_files=true
fi

if [ "$missing_files" = true ]; then
    echo ""
    echo -e "${YELLOW}📝 Setup required:${NC}"
    echo ""
    echo -e "${CYAN}   1. Paste your JWT token into: ${NC}.jwt_token"
    echo -e "${CYAN}   2. Paste your a1Data cookie into: ${NC}.a1data"
    echo -e "${CYAN}      (Get this from your browser's cookies - it will be URL encoded)${NC}"
    echo -e "${CYAN}   3. Save both files${NC}"
    echo -e "${CYAN}   4. Run this script again${NC}"
    echo ""
    exit 1
fi

# Read JWT token from file
JWT_TOKEN=$(cat .jwt_token | xargs)

if [ -z "$JWT_TOKEN" ]; then
    echo -e "${RED}❌ Error: .jwt_token file is empty${NC}"
    echo ""
    echo -e "${YELLOW}📝 Please paste your JWT token into the .jwt_token file and try again${NC}"
    exit 1
fi

# Read and decode a1data from file (preserve exact content, just strip trailing newline)
A1_DATA=$(cat .a1data | tr -d '\n\r')

if [ -z "$A1_DATA" ]; then
    echo -e "${RED}❌ Error: .a1data file is empty${NC}"
    echo ""
    echo -e "${YELLOW}📝 Please paste your a1Data cookie into the .a1data file and try again${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Loaded JWT token from .jwt_token (${#JWT_TOKEN} characters)${NC}"
echo -e "${GREEN}✅ Loaded a1Data from .a1data (${#A1_DATA} characters)${NC}"

# Setup logging to file
LOG_FILE="camping_poll_$(date '+%Y%m%d_%H%M%S').log"
echo -e "${GREEN}✅ Logging to: ${LOG_FILE}${NC}"

# Redirect all output to both console and log file
exec > >(tee -a "$LOG_FILE")
exec 2>&1

# Debug output to verify content
echo -e "${YELLOW}⏳ Initializing poller...${NC}"
sleep 0.5
echo -e "${GREEN}✅ Starting polling (press Ctrl+C to stop)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if input.json exists
if [ ! -f "input.json" ]; then
    echo -e "${RED}❌ Error: input.json not found${NC}"
    echo -e "${YELLOW}Please create an input.json file with your campsite data${NC}"
    exit 1
fi

# Function to get shopping cart and extract cart item IDs
get_cart_items() {
    local response=$(curl -s -w "\n%{http_code}" --connect-timeout 10 --max-time 10 \
        --location "https://api.reserveamerica.com/jaxrs-json/shoppingcart/0" \
        --header "a1data: $A1_DATA" \
        --header "accept: application/json" \
        --header "accept-language: en-US,en;q=0.9" \
        --header "access-control-allow-headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,humanVerificationToken,humanVerificationTokenV3,humanVerificationActionV3,a1Data,privateKey,access-control-allow-methods,X-Requested-With,Access-Control-Allow-Origin,Accept,Origin,Access-Control-Allow-Headers,Access-Control-Request-Headers" \
        --header "access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT" \
        --header "access-control-allow-origin: https://www.reserveamerica.com/" \
        --header "authorization: $JWT_TOKEN" \
        --header "cache-control: no-cache" \
        --header "content-type: application/json" \
        --header "humanverificationactionv3;" \
        --header "humanverificationtoken;" \
        --header "humanverificationtokenv3;" \
        --header "origin: https://www.reserveamerica.com" \
        --header "pragma: no-cache" \
        --header "priority: u=1, i" \
        --header "referer: https://www.reserveamerica.com/" \
        --header "sec-ch-ua: \"Google Chrome\";v=\"141\", \"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"141\"" \
        --header "sec-ch-ua-mobile: ?0" \
        --header "sec-ch-ua-platform: \"macOS\"" \
        --header "sec-fetch-dest: empty" \
        --header "sec-fetch-mode: cors" \
        --header "sec-fetch-site: same-site" \
        --header "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")
    
    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        # Extract all cartItemId values from the response
        echo "$body" | grep -o '"cartItemId":"[^"]*"' | sed 's/"cartItemId":"\(.*\)"/\1/'
    else
        echo ""
    fi
}

# Function to remove item from cart
remove_cart_item() {
    local cart_item_id=$1
    
    echo -e "${YELLOW}🗑️  Removing cart item $cart_item_id...${NC}"
    
    local response=$(curl -s -w "\n%{http_code}" --connect-timeout 10 --max-time 10 \
        --location "https://api.reserveamerica.com/jaxrs-json/shoppingcart/0/remove" \
        --header "a1data: $A1_DATA" \
        --header "accept: application/json" \
        --header "accept-language: en-US,en;q=0.9" \
        --header "access-control-allow-headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,humanVerificationToken,humanVerificationTokenV3,humanVerificationActionV3,a1Data,privateKey,access-control-allow-methods,X-Requested-With,Access-Control-Allow-Origin,Accept,Origin,Access-Control-Allow-Headers,Access-Control-Request-Headers" \
        --header "access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT" \
        --header "access-control-allow-origin: https://www.reserveamerica.com/" \
        --header "authorization: $JWT_TOKEN" \
        --header "cache-control: no-cache" \
        --header "content-type: application/json" \
        --header "humanverificationactionv3;" \
        --header "humanverificationtoken;" \
        --header "humanverificationtokenv3;" \
        --header "origin: https://www.reserveamerica.com" \
        --header "pragma: no-cache" \
        --header "priority: u=1, i" \
        --header "referer: https://www.reserveamerica.com/" \
        --header "sec-ch-ua: \"Google Chrome\";v=\"141\", \"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"141\"" \
        --header "sec-ch-ua-mobile: ?0" \
        --header "sec-ch-ua-platform: \"macOS\"" \
        --header "sec-fetch-dest: empty" \
        --header "sec-fetch-mode: cors" \
        --header "sec-fetch-site: same-site" \
        --header "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" \
        --data "[{\"value\":\"$cart_item_id\"}]")
    
    local http_code=$(echo "$response" | tail -n 1)
    
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ Successfully removed cart item $cart_item_id${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to remove cart item $cart_item_id (HTTP $http_code)${NC}"
        return 1
    fi
}

# Function to handle cart clearing
clear_cart_interactive() {
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠️  CART CONFLICT DETECTED${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${CYAN}You've reached the maximum number of overlapping reservations.${NC}"
    echo -e "${CYAN}You need to clear items from your cart before adding more.${NC}"
    echo ""
    echo -e "${YELLOW}Do you want to clear all items from your cart? (y/n):${NC} "
    read -r response
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo ""
        echo -e "${BLUE}🔍 Fetching cart items...${NC}"
        
        local cart_items=$(get_cart_items)
        
        if [ -z "$cart_items" ]; then
            echo -e "${RED}❌ No cart items found or failed to retrieve cart${NC}"
            return 1
        fi
        
        local item_count=$(echo "$cart_items" | wc -l | xargs)
        echo -e "${CYAN}Found $item_count item(s) in cart${NC}"
        echo ""
        
        # Remove each item
        local success_count=0
        while IFS= read -r cart_item_id; do
            if [ -n "$cart_item_id" ]; then
                remove_cart_item "$cart_item_id"
                if [ $? -eq 0 ]; then
                    ((success_count++))
                fi
                sleep 0.5
            fi
        done <<< "$cart_items"
        
        echo ""
        echo -e "${GREEN}✅ Cleared $success_count of $item_count items from cart${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}🔄 Resuming polling...${NC}"
        echo ""
        return 0
    else
        echo ""
        echo -e "${YELLOW}⏭️  Cart not cleared. Resuming polling anyway...${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        return 1
    fi
}

# Function to add item to cart
add_item() {
    local post_data=$1
    local url="https://api.reserveamerica.com/jaxrs-json/shoppingcart/0/additem"
    
    # Extract key info from JSON for description
    local site_id=$(echo "$post_data" | grep -o '"siteID":"[^"]*"' | sed 's/"siteID":"\(.*\)"/\1/')
    local facility_id=$(echo "$post_data" | grep -o '"facilityID":"[^"]*"' | sed 's/"facilityID":"\(.*\)"/\1/')
    local arrival_date=$(echo "$post_data" | grep -o '"arrivalDate":"[^"]*"' | sed 's/"arrivalDate":"\(.*\)"/\1/')
    
    # Get current timestamp with milliseconds
    local timestamp=$(python3 -c 'from datetime import datetime; print(datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3])' 2>/dev/null)
    
    # Show loading state
    echo -e "${BLUE}🔄 [${timestamp}] Adding site ${site_id} (Facility ${facility_id}) - ${arrival_date}...${NC}"
    
    # Make the request and capture response (with 10 second timeout)
    local response=$(curl -s -w "\n%{http_code}" --connect-timeout 10 --max-time 10 --location "$url" \
        --header "a1data: $A1_DATA" \
        --header "accept: application/json" \
        --header "accept-language: en-US,en;q=0.9" \
        --header "access-control-allow-headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,humanVerificationToken,humanVerificationTokenV3,humanVerificationActionV3,a1Data,privateKey,access-control-allow-methods,X-Requested-With,Access-Control-Allow-Origin,Accept,Origin,Access-Control-Allow-Headers,Access-Control-Request-Headers" \
        --header "access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT" \
        --header "access-control-allow-origin: https://www.reserveamerica.com/" \
        --header "authorization: $JWT_TOKEN" \
        --header "cache-control: no-cache" \
        --header "content-type: application/json" \
        --header "humanverificationactionv3;" \
        --header "humanverificationtokenv3;" \
        --header "origin: https://www.reserveamerica.com" \
        --header "pragma: no-cache" \
        --header "priority: u=1, i" \
        --header "referer: https://www.reserveamerica.com/" \
        --header "sec-ch-ua: \"Google Chrome\";v=\"141\", \"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"141\"" \
        --header "sec-ch-ua-mobile: ?0" \
        --header "sec-ch-ua-platform: \"macOS\"" \
        --header "sec-fetch-dest: empty" \
        --header "sec-fetch-mode: cors" \
        --header "sec-fetch-site: same-site" \
        --header "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" \
        --data "$post_data")
    
    # Check if curl command succeeded
    local curl_exit_code=$?
    if [ $curl_exit_code -ne 0 ]; then
        echo -e "${RED}❌ Connection failed (timeout or network error)${NC}"
        echo ""
        return
    fi
    
    # Extract status code (last line) and body (everything else)
    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')
    
    # Check for 000 response (rate limited / blocked)
    if [ "$http_code" = "000" ]; then
        echo -e "${YELLOW}⚠️  HTTP 000 - Rate limited or connection error. Retrying in 10ms...${NC}"
        # Brief backoff then continue without exiting (10ms)
        sleep 0.1
        return
    fi
    
    # Process response based on status code
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ Success (200)${NC}"
        if [ -n "$body" ]; then
            echo -e "${GREEN}   Response: ${body:0:200}${NC}"
        fi
    elif [ "$http_code" -ge 400 ] && [ "$http_code" -lt 600 ]; then
        echo -e "${RED}❌ Error (${http_code})${NC}"
        
        # Check if this is the overlapping reservations error
        if echo "$body" | grep -q "Maximum number of overlapping reservations"; then
            # Show the error message
            echo -e "${RED}   Full Response Body:${NC}"
            echo -e "${CYAN}$body${NC}"
            echo ""
            
            # Trigger interactive cart clearing
            clear_cart_interactive
            return
        fi
        
        # Show full response body for debugging
        if [ -n "$body" ]; then
            echo -e "${RED}   Full Response Body:${NC}"
            echo -e "${CYAN}$body${NC}"
        else
            echo -e "${RED}   (Empty response body)${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Unexpected status (${http_code})${NC}"
        if [ -n "$body" ]; then
            echo -e "${YELLOW}   Response: ${body:0:200}${NC}"
        fi
    fi
    
    echo ""
}

# Read input.json once
INPUT_DATA=$(cat input.json | tr -d '\n\r')

# Main polling loop - AGGRESSIVE MODE
# Fires requests continuously in background without waiting for responses
cycle_count=0
echo -e "${YELLOW}⚡ AGGRESSIVE MODE: Firing continuous parallel requests${NC}"
echo -e "${YELLOW}⚡ Responses will appear as they complete${NC}"
echo ""

while true; do
    cycle_count=$((cycle_count + 1))
    
    # Fire request in background (don't wait for response)
    add_item "$INPUT_DATA" &
    
    # Tiny delay to prevent overwhelming the system (optional - remove if you want max speed)
    sleep 0.01
done

