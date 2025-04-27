#!/bin/bash

# 游戏服务端快速部署脚本集合
# 此文件包含各种游戏服务端的一键部署脚本
# 版本: 1.0.0
# 更新日期: 2023-06-01

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # 无颜色

# 游戏安装目录
GAMES_DIR="/home/steam/games"

# 函数：显示安装后提示信息
show_post_install_tips() {
    local game_name=$1
    local install_dir="$GAMES_DIR/$game_name"
    
    echo -e "\n${GREEN}+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+${NC}"
    echo -e "${GREEN}|               安装后提示                        |${NC}"
    echo -e "${GREEN}+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+${NC}"
    echo -e "${YELLOW}• 游戏安装位置: ${NC}$install_dir"
    echo -e "${YELLOW}• 启动游戏方法:${NC}"
    echo -e "  1. 从主菜单选择 [${GREEN}2${NC}] 管理已安装游戏"
    echo -e "  2. 选择 ${GREEN}$game_name${NC} 游戏"
    echo -e "  3. 选择 [${GREEN}1${NC}] 启动服务端"
    echo -e "${YELLOW}• 如需手动启动:${NC}"
    echo -e "  cd $install_dir && ./start.sh"
    echo -e "${YELLOW}• 如需修改配置:${NC}"
    echo -e "  从游戏菜单中选择 [${GREEN}3${NC}] 编辑配置文件 或 [${GREEN}5${NC}] 编写/修改启动脚本"
    
    # 根据不同游戏添加特定提示
    case "$game_name" in
        "Palworld")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 DefaultPalWorldSettings.ini"
            echo -e "  - 存档位于 Pal/Saved/SaveGames"
            echo -e "  - 默认游戏端口: 8211 UDP"
            ;;
        "Rust")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 服务器第一次启动时会生成地图，配置较低非固态盘可能需要很长一段时间"
            echo -e "  - 存档位于 Serveridentity"
            echo -e "  - 请确保服务器有足够的内存（推荐至少8GB）"
            ;;
        "Satisfactory")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 Config/Game.ini"
            echo -e "  - 存档位置 位于映射的通用游戏存档路径目录中"
            echo -e "  - 默认游戏端口: 7777 UDP"
            ;;
        "L4D2")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 server.cfg"
            echo -e "  - 存档位置 尚未知晓"
            echo -e "  - 默认游戏端口: 27015 TCP"
            ;;
        "7_Days_to_Die")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 serverconfig.xml serveradmin.xml players.xml"
            echo -e "  - 存档位置 位于映射的通用游戏存档路径2目录中"
            echo -e "  - 默认游戏端口: 26900 TCP"
            echo -e "${YELLOW}• 注意事项:${NC}"
            echo -e "  - 游戏启动需要2-5分钟才能彻底启动完毕，请等待提示第二遍的"服务端已运行"提示则代表服务器运行成功"
            echo -e "  - ERROR: Shader Game Particles/Standard Surface shader is not supported on this GPU (none of subshaders/fallbacks are suitable) 由于服务端采用unity运行环境 此报错是由于无法使用GPU，这个不影响使用可以忽略，并在彻底启动后停止输出"
            ;;
        "Unturned")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 存档位置 Servers 目录中"
            echo -e "  - 默认游戏端口: 27015 UDP"
            ;;
        "Don't_Starve_Together")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "请注意此服务端需要从客户端上传存档以及配置文件，需要自行编写启动脚本，详见文章https://www.bilibili.com/opus/798802812813180931"
            ;;
        "install_Project_Zomboid")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 尚未知晓 可能在服务端外的其它目录中"
            echo -e "  - 存档位置 尚未确定"
            echo -e "  - 默认游戏端口: 16261 16262 UDP"
            ;;
        "Valheim")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 位于启动脚本中"
            echo -e "  - 存档位置 位于映射的通用游戏存档路径1目录中"
            echo -e "  - 默认游戏端口: 2457 UDP"
            ;;
        "Team_Fortress_2")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 位于tf/cfg中"
            echo -e "  - 存档位置 位于tf目录中"
            echo -e "  - 默认游戏端口: 27015 UDP TCP"
            ;;
        "Insurgency_Sandstorm")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 位于Insurgency/Saved/Config中"
            echo -e "  - 存档位置 位于映射的通用游戏存档路径1目录中"
            echo -e "  - 默认游戏端口: 27015 UDP TCP"
            ;;
        "Killing_Floor_2")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 位于KFGame/Config/LinuxServer中"
            echo -e "  - 存档位置 尚未知晓"
            echo -e "  - 默认游戏端口: 尚未确定"
            ;;
        "ARK")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 位于ShooterGame/Saved/Config/LinuxServer中"
            echo -e "  - 存档位置 hooterGame/Saved"
            echo -e "  - 默认游戏端口: 7777 7778 27015 UDP"
            echo -e "  - bash: cannot set terminal process group 警告是由于服务端控制终端问题，可以忽略，只不过会没有任何输出和输入。"
            echo -e "  - [S_API FAIL] SteamAPI_Init() failed 错误 是由于游戏目录没有再steamcmd所以无法识别到steam，可以忽略。"
            echo -e "  - 运行后由于终端无法输出，需以容器显示为主，当出现7777端口已开放则代表服务端已运行，可以正常使用。"
            ;;
        "Squad")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 位于SquadGame/ServerConfig中"
            echo -e "  - 存档位置 尚未知晓"
            echo -e "  - 默认游戏端口: 7787 27165 UDP"
            ;;
        "Insurgency_2014")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 尚未知晓"
            echo -e "  - 存档位置 尚未知晓"
            echo -e "  - 默认游戏端口: 27015 UDP TCP"
            ;;
        "Last_Oasis")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 Engine/Saved/Config/LinuxServer"
            echo -e "  - 存档位置 尚未知晓"
            echo -e "  - 默认游戏端口: 尚未知晓"
            ;;
        "Euro_Truck_Simulator_2")
            echo -e "${YELLOW}• 额外提示:${NC}"
            echo -e "  - 配置文件 通用游戏存档路径1"
            echo -e "  - 存档位置 通用游戏存档路径1"
            echo -e "  - 默认游戏端口: 27015 UDP  ​​100-200​​ UDP(查询端口可选开通)"
            echo -e "  - 此服务端需要自行从客户端生成配置文件上传才可以开服"
            ;;  
            
    esac
}

# 函数：询问用户是否创建MCSM实例
ask_create_mcsm_instance() {
    local game_name="$1"
    local server_name="$2"
    local image="${3:-dockerwork-steam-server:latest}"
    local start_command="${4:-./start.sh}"
    
    echo -e "\n${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║           ${GREEN}MCSManager服务注册${BLUE}                    ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    
    echo -e "\n${YELLOW}是否要将此游戏服务器注册到MCSManager面板？[y/N]${NC}"
    read -n 1 -r register_choice
    echo ""
    
    if [[ "$register_choice" =~ ^[Yy]$ ]]; then
        # 首先尝试使用容器内置的MCSM库文件(Dockerfile复制的)，然后再查找其他位置
        local mcsm_lib=""
        for lib_path in \
            "/home/steam/MCSM/mcsm_api_lib.sh" \
            "/home/steam/games/MCSM/mcsm_api_lib.sh" \
            "/MCSM/mcsm_api_lib.sh" \
            "/home/steam/mcsm_api_lib.sh"; do
            if [ -f "$lib_path" ]; then
                mcsm_lib="$lib_path"
                break
            fi
        done
        
        if [ -n "$mcsm_lib" ]; then
            echo -e "${GREEN}找到MCSManager API库: $mcsm_lib${NC}"
            echo -e "${GREEN}正在加载MCSManager API库...${NC}"
            
            # 尝试加载库文件
            if source "$mcsm_lib"; then
                # 检查必要的函数是否存在
                if ! type mcsm_create_custom_instance >/dev/null 2>&1; then
                    echo -e "${RED}错误: MCSManager API库加载失败，找不到必要的函数${NC}"
                    echo -e "${YELLOW}跳过创建MCSManager实例${NC}"
                    return 1
                fi
                
                # 根据游戏命名实例
                local nice_name=""
                case "$game_name" in
                    "Palworld") nice_name="幻兽帕鲁";;
                    "Rust") nice_name="腐蚀";;
                    "Satisfactory") nice_name="幸福工厂";;
                    "L4D2") nice_name="求生之路2";;
                    "7_Days_to_Die") nice_name="七日杀";;
                    "Unturned") nice_name="未转变者";;
                    "Don't_Starve_Together") nice_name="饥荒联机版";;
                    "Project_Zomboid") nice_name="僵尸毁灭工程";;
                    "Valheim") nice_name="英灵神殿";;
                    "Team_Fortress_2") nice_name="军团要塞2";;
                    "Insurgency_Sandstorm") nice_name="叛乱：沙漠风暴";;
                    "Killing_Floor_2") nice_name="杀戮空间2";;
                    "ARK") nice_name="方舟：生存进化";;
                    "Squad") nice_name="战术小队";;
                    "Insurgency_2014") nice_name="叛乱2";;
                    "Last_Oasis") nice_name="最后的绿洲";;
                    "Euro_Truck_Simulator_2") nice_name="欧洲卡车模拟2";;
                    *) nice_name="$server_name";;
                esac
                
                local display_name="$nice_name 服务器"
                
                # 使用自定义实例创建函数
                echo -e "${GREEN}正在创建MCSManager实例: $display_name${NC}"
                
                # 如果存在特定游戏的启动端口，添加端口映射
                local ports="[]"
                case "$game_name" in
                    "Palworld")
                        ports='["8211:8211/udp"]'
                        ;;
                    "Rust")
                        ports='["28015:28015/udp","28016:28016/tcp"]'
                        ;;
                    "Satisfactory")
                        ports='["7777:7777/udp"]'
                        ;;
                    "L4D2")
                        ports='["27015:27015/tcp"]'
                        ;;
                    "7_Days_to_Die")
                        ports='["26900:26900/tcp"]'
                        ;;
                    "Unturned")
                        ports='["27015:27015/udp"]'
                        ;;
                    "Project_Zomboid")
                        ports='["16261:16261/udp","16262:16262/udp"]'
                        ;;
                    "Valheim")
                        ports='["2457:2457/udp"]'
                        ;;
                    "Team_Fortress_2")
                        ports='["27015:27015/tcp","27015:27015/udp"]'
                        ;;
                    "Insurgency_Sandstorm")
                        ports='["27015:27015/tcp","27015:27015/udp"]'
                        ;;
                    "Killing_Floor_2")
                        ports='[]'
                        ;;
                    "ARK")
                        ports='["7777:7777/udp","7778:7778/udp","27015:27015/udp"]'
                        ;;
                    "Squad")
                        ports='["7787:7787/udp","27165:27165/udp"]'
                        ;;
                    "Insurgency_2014")
                        ports='["27015:27015/tcp","27015:27015/udp"]'
                        ;;
                    "Last_Oasis")
                        ports='[]'
                        ;;
                    "Euro_Truck_Simulator_2")
                        ports='[]'
                        ;;
                esac
                
                # 设置环境变量
                local env='["AUTO_UPDATE=false","GAME_TO_RUN='$game_name'"]'
                
                # 创建实例
                mcsm_create_custom_instance "$display_name" "$game_name" "$image" "$start_command" "$ports" "$env"
                
                if [ $? -eq 0 ]; then
                    echo -e "${GREEN}MCSManager实例创建成功！${NC}"
                    echo -e "${YELLOW}您可以在MCSManager面板中管理此服务器${NC}"
                    return 0
                else
                    echo -e "${RED}MCSManager实例创建失败，请手动创建${NC}"
                    return 1
                fi
            else
                echo -e "${RED}错误: 无法加载MCSManager API库${NC}"
                echo -e "${YELLOW}跳过创建MCSManager实例${NC}"
                return 1
            fi
        else
            echo -e "${RED}错误: 找不到MCSManager API库${NC}"
            echo -e "${YELLOW}未找到以下任何位置的库文件:${NC}"
            echo -e "  - /home/steam/MCSM/mcsm_api_lib.sh (容器内置)"
            echo -e "  - /home/steam/games/MCSM/mcsm_api_lib.sh (挂载目录)"
            echo -e "  - /MCSM/mcsm_api_lib.sh"
            echo -e "  - /home/steam/mcsm_api_lib.sh"
            echo -e "${YELLOW}请确保MCSM库文件已正确安装${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}跳过创建MCSManager实例${NC}"
        return 0
    fi
}

# 函数：Steam游戏通用安装函数
install_steam_game() {
    local app_id=$1
    local game_name=$2
    local use_custom_account=${3:-false}  # 默认为false，使用匿名账户
    local install_dir="$GAMES_DIR/$game_name"
    
    echo -e "${GREEN}正在安装 $game_name (AppID: $app_id) 到 $install_dir...${NC}\n"
    echo -e "${YELLOW}这可能需要一段时间，请耐心等待...${NC}\n"
    
    # 创建安装目录
    mkdir -p "$install_dir"
    
    # 设置登录命令
    if [ "$use_custom_account" = true ]; then
        echo -e "${YELLOW}由于此服务端需要正版验证，请登录已购买后的游戏账户${NC}"
        echo -e "${YELLOW}请输入Steam账户: ${NC}"
        read steam_account
        echo -e "${YELLOW}是否需要输入密码？(y/n)${NC}"
        read need_password
        
        if [[ "$need_password" == "y" || "$need_password" == "Y" ]]; then
            echo -e "${YELLOW}请输入密码 (密码不会显示): ${NC}"
            read -s steam_password
            login_cmd="+login $steam_account $steam_password"
        else
            login_cmd="+login $steam_account"
        fi
    else
        login_cmd="+login anonymous"
    fi
    
    # 运行SteamCMD安装游戏
    if [ -x "/home/steam/steamcmd/steamcmd.sh" ]; then
        cd /home/steam/steamcmd
        ./steamcmd.sh $login_cmd +force_install_dir "$install_dir" +app_update "$app_id" validate +quit
        
        # 检查游戏是否安装成功
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}$game_name 安装成功!${NC}"
            
            # 保存AppID到游戏目录
            echo "$app_id" > "$install_dir/steam_appid.txt"
            
            return 0
        else
            echo -e "${RED}$game_name 安装失败!${NC}"
            return 1
        fi
    else
        echo -e "${RED}错误: 找不到SteamCMD可执行文件!${NC}"
        return 1
    fi
}

# 函数：在游戏服务端目录创建文件
create_game_file() {
    local install_dir=$1
    local file_name=$2
    local file_content=$3
    
    # 创建完整的文件路径
    local file_path="$install_dir/$file_name"
    
    # 创建文件并写入内容
    echo "$file_content" > "$file_path"
    
    # 检查文件是否创建成功
    if [ -f "$file_path" ]; then
        echo -e "${GREEN}文件 $file_name 创建成功!${NC}"
        return 0
    else
        echo -e "${RED}文件 $file_name 创建失败!${NC}"
        return 1
    fi
}

# 函数：创建自定义启动脚本
create_startup_script() {
    local install_dir=$1
    local script_content=$2
    
    echo "$script_content" > "$install_dir/start.sh"
    chmod +x "$install_dir/start.sh"
    
    if [ -x "$install_dir/start.sh" ]; then
        echo -e "${GREEN}启动脚本创建成功!${NC}"
        return 0
    else
        echo -e "${RED}启动脚本创建失败!${NC}"
        return 1
    fi
}

# 函数：清理安装目录（如果安装失败）
cleanup_install() {
    local install_dir=$1
    echo -e "${YELLOW}正在清理安装目录...${NC}"
    rm -rf "$install_dir"
}

# 函数：安装调试工具
install_debug_tools() {
    echo -e "${YELLOW}正在安装调试工具，这可能需要root权限...${NC}"
    if [ $(id -u) -ne 0 ]; then
        echo -e "${RED}警告: 非root用户，某些工具可能无法安装${NC}"
    fi
    
    # 更新apt源并安装调试工具
    apt-get update -y 2>/dev/null || echo -e "${RED}无法更新apt源，继续安装...${NC}"
    apt-get install -y gdb strace ltrace lsof procps 2>/dev/null || echo -e "${RED}无法安装部分调试工具，继续...${NC}"
    
    # 显示安装了哪些工具
    echo -e "${GREEN}已安装的调试工具:${NC}"
    which gdb strace ltrace lsof 2>/dev/null
    
    echo -e "\n${YELLOW}系统信息:${NC}"
    free -h
    df -h
    cat /proc/cpuinfo | grep "model name" | head -1
}

#====================================================
# 以下是各游戏的安装脚本
#====================================================


# 安装 Palworld 服务端
install_palworld() {
    local game_name="Palworld"
    local app_id=2394010
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户
    
    echo -e "${BLUE}========== 安装 Palworld 服务端 ==========${NC}"
    
    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
cd "$(dirname "$0")"
./PalServer.sh -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS -port=8211 -players=32
EOL
)
    create_startup_script "$install_dir" "$script"
    
    echo -e "${GREEN}Palworld 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 Rust 服务端
install_rust() {
    local game_name="Rust"
    local app_id=258550
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户
    
    echo -e "${BLUE}========== 安装 Rust 服务端 ==========${NC}"
    
    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
cd "$(dirname "$0")"
./RustDedicated -batchmode +server.hostname "My Rust Server" +server.identity "my_server" +server.port 28015 +server.maxplayers 50 +server.worldsize 3000 +server.seed 12345 +server.saveinterval 300
EOL
)
    create_startup_script "$install_dir" "$script"
    
    echo -e "${GREEN}Rust 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 Satisfactory 服务端
install_satisfactory() {
    local game_name="Satisfactory"
    local app_id=1690800
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 Satisfactory 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    echo -e "${GREEN}Satisfactory 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 L4D2 服务端
install_L4D2() {
    local game_name="L4D2"
    local app_id=222860
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-true}  # 默认为true，使用自定义账户

    echo -e "${BLUE}========== 安装 L4D2 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
cd "$(dirname "$0")"
./srcds_run -game left4dead2 -console -port 27015 +exec server.cfg +map c1m1_hotel
EOL
)    
    create_startup_script "$install_dir" "$script"
    
    echo -e "${GREEN}L4D2 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 7 Days to Die 服务端
install_7DaysToDie() {
    local game_name="7_Days_to_Die"
    local app_id=294420
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 7 Days to Die 服务端 ==========${NC}"
    echo -e "${RED}此服务端需要要求较高配置，至少需要分配4G以上内存以及4核以上较高性能CPU才可以，内存过低可能无法启动。${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    # 创建标准启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
cd "$(dirname "$0")"

# 确保配置文件存在
if [ ! -f "serverconfig.xml" ]; then
  echo "错误: serverconfig.xml 配置文件不存在！"
  exit 1
fi

# 设置系统参数 - 如果没有权限则忽略错误
echo "尝试设置系统参数..."
ulimit -n 10240 2>/dev/null || echo "警告: 无法设置ulimit (非root用户)"
# 尝试修改max_map_count，但如果失败则不中断
if [ -w "/proc/sys/vm/max_map_count" ]; then
  echo 262144 > /proc/sys/vm/max_map_count
else
  echo "警告: 无法修改/proc/sys/vm/max_map_count (需要root权限或--privileged参数)"
  echo "当前值: $(cat /proc/sys/vm/max_map_count 2>/dev/null || echo "无法读取")"
fi

# 设置关键环境变量
export LD_LIBRARY_PATH="./7DaysToDieServer_Data/Plugins:$LD_LIBRARY_PATH"
export MALLOC_ARENA_MAX=1
export MALLOC_MMAP_THRESHOLD=131072

# 创建必要的目录结构
mkdir -p ~/.local/share/7DaysToDie/Saves

echo "启动7日杀服务端..."
./7DaysToDieServer.x86_64 -batchmode -nographics -dedicated -configfile=serverconfig.xml
EOL
)
    create_startup_script "$install_dir" "$script"

    # 创建调试用的启动脚本
    local debug_script=$(cat << 'EOL'
#!/bin/bash
cd "$(dirname "$0")"

# 确保配置文件存在
if [ ! -f "serverconfig.xml" ]; then
  echo "错误: serverconfig.xml 配置文件不存在！"
  exit 1
fi

# 设置系统参数 - 如果没有权限则忽略错误
echo "尝试设置系统参数..."
ulimit -n 10240 2>/dev/null || echo "警告: 无法设置ulimit (非root用户)"
# 尝试修改max_map_count，但如果失败则不中断
if [ -w "/proc/sys/vm/max_map_count" ]; then
  echo 262144 > /proc/sys/vm/max_map_count
else
  echo "警告: 无法修改/proc/sys/vm/max_map_count (需要root权限或--privileged参数)"
  echo "当前值: $(cat /proc/sys/vm/max_map_count 2>/dev/null || echo "无法读取")"
fi

# 设置关键环境变量
export LD_LIBRARY_PATH="./7DaysToDieServer_Data/Plugins:$LD_LIBRARY_PATH"
export MALLOC_ARENA_MAX=1
export MALLOC_MMAP_THRESHOLD=131072

# 创建必要的目录结构
mkdir -p ~/.local/share/7DaysToDie/Saves

echo "===== 使用strace跟踪启动过程，查找具体崩溃点... ====="
# strace跟踪系统调用，查找崩溃点
strace -f -e trace=file,process,signal,desc,network ./7DaysToDieServer.x86_64 -dedicated -configfile=serverconfig.xml > strace_output.log 2>&1

echo "===== strace执行完成 ====="
echo "如需查看崩溃信息，请运行: less strace_output.log"
EOL
)
    create_game_file "$install_dir" "debug_start.sh" "$debug_script"
    chmod +x "$install_dir/debug_start.sh"

    # 直接创建配置文件
    local config_content=$(cat << 'EOL'
<?xml version="1.0"?>
<ServerSettings>
	<property name="ServerPort" value="26900"/>
	<property name="ServerName" value="My 7 Days to Die Server"/>
	<property name="ServerPassword" value=""/>
	<property name="ServerMaxPlayerCount" value="8"/>
	<property name="ServerDescription" value="A 7 Days to Die server"/>
	<property name="ServerWebsiteURL" value=""/>
	<property name="GameWorld" value="Navezgane"/>
	<property name="GameName" value="My Game"/>
	<property name="GameDifficulty" value="2"/>
	<property name="ServerLoginConfirmationText" value="Welcome to my 7 Days to Die server!"/>
	<property name="AdminFileName" value="serveradmin.xml"/>
</ServerSettings>
EOL
)
    echo "$config_content" > "$install_dir/serverconfig.xml"
    chmod 644 "$install_dir/serverconfig.xml"

    echo -e "${GREEN}7 Days to Die 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 Unturned 服务端
install_Unturned() {
    local game_name="Unturned"
    local app_id=1110390
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 Unturned 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    echo -e "${GREEN}Unturned 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 饥荒联机版 服务端
install_DST() {
    local game_name="Don't_Starve_Together"
    local app_id=343050
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 饥荒联机版 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    echo -e "${GREEN}饥荒联机版 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 僵尸毁灭工程 服务端
install_Project_Zomboid() {
    local game_name="Project_Zomboid"
    local app_id=380870
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 僵尸毁灭工程 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    echo -e "${GREEN}僵尸毁灭工程 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 英灵神殿 服务端
install_Valheim() {
    local game_name="Valheim"
    local app_id=896660
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 英灵神殿 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    echo -e "${GREEN}英灵神殿 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 军团要塞2 服务端
install_Team_Fortress_2() {
    local game_name="Team_Fortress_2"
    local app_id=232250
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 军团要塞2 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi

    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
cd "$(dirname "$0")"
./srcds_run -game tf +map ctf_2fort.bsp
EOL
)
    create_startup_script "$install_dir" "$script" 

    echo -e "${GREEN}军团要塞2 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 叛乱：沙漠风暴 服务端
install_Insurgency_Sandstorm() {
    local game_name="Insurgency_Sandstorm"
    local app_id=581330
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 叛乱：沙漠风暴 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi

    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
cd "$(dirname "$0")"
Insurgency/Binaries/Linux/InsurgencyServer-Linux-Shipping Gap?Scenario_Gap_Checkpoint_Security?MaxPlayers=28 -Port=27102 -QueryPort=27131 -log -hostname="My Server"
EOL
)
    create_startup_script "$install_dir" "$script" 

    echo -e "${GREEN}叛乱：沙漠风暴 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 杀戮空间2 服务端
install_Killing_Floor_2() {
    local game_name="Killing_Floor_2"
    local app_id=232130
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 杀戮空间2 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi

    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
cd "$(dirname "$0")"
Insurgency/Binaries/Linux/InsurgencyServer-Linux-Shipping Gap?Scenario_Gap_Checkpoint_Security?MaxPlayers=28 -Port=27102 -QueryPort=27131 -log -hostname="My Server"
EOL
)
    create_startup_script "$install_dir" "$script" 

    echo -e "${GREEN}杀戮空间2 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 方舟：生存进化 服务端
install_ARK() {
    local game_name="ARK"
    local app_id=376030
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 方舟：生存进化 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi

    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
cd "$(dirname "$0")"
Insurgency/Binaries/Linux/InsurgencyServer-Linux-Shipping Gap?Scenario_Gap_Checkpoint_Security?MaxPlayers=28 -Port=27102 -QueryPort=27131 -log -hostname="My Server"
EOL
)
    create_startup_script "$install_dir" "$script" 

    echo -e "${GREEN}方舟：生存进化 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 战术小队 服务端
install_Squad() {
    local game_name="Squad"
    local app_id=403240
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 战术小队 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi

    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
UE4_TRUE_SCRIPT_NAME=$(echo \"$0\" | xargs readlink -f)
UE4_PROJECT_ROOT=$(dirname "$UE4_TRUE_SCRIPT_NAME")
chmod +x "$UE4_PROJECT_ROOT/SquadGame/Binaries/Linux/SquadGameServer"
"$UE4_PROJECT_ROOT/SquadGame/Binaries/Linux/SquadGameServer" SquadGame -Port=7787 -QueryPort=27165 "$@"
EOL
)
    create_startup_script "$install_dir" "$script" 

    echo -e "${GREEN}战术小队 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 叛乱2 服务端
install_Insurgency_2014() {
    local game_name="Insurgency_2014"
    local app_id=237410
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 叛乱2 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi

    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
./srcds_run
EOL
)
    create_startup_script "$install_dir" "$script" 

    echo -e "${GREEN}叛乱2 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 最后的绿洲 服务端
install_Last_Oasis() {
    local game_name="Last_Oasis"
    local app_id=920720
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 最后的绿洲 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi

    echo -e "${GREEN}最后的绿洲 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 安装 欧洲卡车模拟2 服务端
install_Euro_Truck_Simulator_2() {
    local game_name="Euro_Truck_Simulator_2"
    local app_id=1948160
    local install_dir="$GAMES_DIR/$game_name"
    local use_custom_account=${1:-false}  # 默认为false，使用匿名账户

    echo -e "${BLUE}========== 安装 欧洲卡车模拟2 服务端 ==========${NC}"

    # 安装游戏
    install_steam_game $app_id "$game_name" "$use_custom_account"
    if [ $? -ne 0 ]; then
        return 1
    fi

    # 创建启动脚本
    local script=$(cat << 'EOL'
#!/bin/bash
cd bin/linux_x64/
./server_launch.sh
EOL
)
    create_startup_script "$install_dir" "$script" 

    echo -e "${GREEN}欧洲卡车模拟2 服务端安装完成!${NC}"
    echo -e "${RED}请注意：请自行查询游戏存档位置，如果存档位置不在游戏根目录请务必将指定目录映射到宿主路径，否则容器删除后将会导致存档丢失！！！${NC}"
    show_post_install_tips "$game_name"
    ask_create_mcsm_instance "$game_name" "$game_name"
    return 0
}

# 获取可用的游戏安装脚本列表
list_available_installers() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║           ${GREEN}游戏服务端快速部署菜单${BLUE}                 ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[1]${NC} Palworld-幻兽帕鲁                             ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[2]${NC} Rust-腐蚀                                     ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[3]${NC} Satisfactory-幸福工厂                         ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[4]${NC} L4D2-求生之路2                                ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[5]${NC} 7 Days to Die-七日杀                          ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[6]${NC} Unturned-未转变者                             ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[7]${NC} Don't Starve Together-饥荒联机版(半自动)      ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[8]${NC} Project Zomboid-僵尸毁灭工程                  ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[9]${NC} Valheim-英灵神殿                              ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[10]${NC} Team Fortress 2-军团要塞2                    ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[11]${NC} Insurgency: Sandstorm-叛乱：沙漠风暴          ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[12]${NC} Killing Floor 2-杀戮空间2                    ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[13]${NC} ARK: Survival Evolved-方舟：生存进化/飞升     ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[14]${NC} Squad-战术小队                               ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[15]${NC} Insurgency 2014-叛乱2                        ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[16]${NC} Last Oasis-最后的绿洲                        ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[17]${NC} Euro Truck Simulator 2-欧洲卡车模拟2(半自动)  ${BLUE}║${NC}"
    echo -e "${BLUE}║  ${YELLOW}[0]${NC} 返回主菜单                                    ${BLUE}║${NC}"
    echo -e "${BLUE}║                                                    ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
}

# 主函数：启动指定的安装脚本
run_installer() {
    local choice=$1
    
    # 不再询问用户，直接根据游戏类型决定是否使用自定义账户
    case $choice in
        1)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║          ${GREEN}正在安装 Palworld 服务端${BLUE}                ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_palworld false  # Palworld使用匿名账户
            ;;
        2)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Rust 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_rust false  # Rust使用匿名账户
            ;;
        3)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Satisfactory 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_satisfactory false  # Satisfactory使用匿名账户
            ;;
        4)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 L4D2 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_L4D2 true  # L4D2需要使用自定义账户
            ;;
        5)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 7 Days to Die 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_7DaysToDie false
            ;;
        6)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Unturned 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_Unturned false
            ;;
        7)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Don't Starve Together 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_DST false
            ;;
        8)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Project Zomboid 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_Project_Zomboid false
            ;;
        9)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Valheim 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_Valheim false
            ;;
        10)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Team Fortress 2 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_Team_Fortress_2 false
            ;;
        11)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Insurgency: Sandstorm 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_Insurgency_Sandstorm false
            ;;
        12)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Killing Floor 2 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_Killing_Floor_2 false
            ;;
        13)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 ARK: Survival Evolved 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_ARK false
            ;;
        14)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Squad 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_Squad false
            ;;
        15)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Insurgency 2014 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_Insurgency_2014 false
            ;;
        16)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Last Oasis 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            install_Last_Oasis false
            ;;
        17)
            clear
            echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║           ${GREEN}正在安装 Euro Truck Simulator 2 服务端${BLUE}                   ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
            echo -e "\n${YELLOW}安装过程可能需要一些时间，请耐心等待...${NC}\n"
            echo -e "\n${RED}请注意：此服务端需要将容器版本升级为1.0.1及更高才可以正常运行，请自行在系统信息中确认当前容器版本。${NC}\n"
            install_Euro_Truck_Simulator_2 false
            ;;
        0)
            echo -e "${YELLOW}返回主菜单...${NC}"
            return 0
            ;;
        *)
            echo -e "${RED}无效选择！${NC}"
            sleep 2
            return 1
            ;;
    esac
    
    local result=$?
    if [ $result -eq 0 ]; then
        echo -e "\n${BLUE}╔════════════════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║               ${GREEN}全部操作已完成！${BLUE}                     ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
        
        # 创建/打开游戏的提醒
        echo -e "\n${YELLOW}游戏服务器已安装完成，您可以:${NC}"
        echo -e "  ${GREEN}1.${NC} 从主菜单选择 [2] 管理已安装游戏 来启动服务器"
        echo -e "  ${GREEN}2.${NC} 如果注册了MCSManager实例，可以通过MCSManager面板管理服务器"
    else
        echo -e "\n${BLUE}╔════════════════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║               ${RED}安装失败！${BLUE}                          ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
    fi
    echo -e "\n${YELLOW}按任意键继续...${NC}"
    read -n 1
    return $result
}

# 如果直接运行此脚本，显示可用安装脚本列表并循环处理选择
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    while true; do
        list_available_installers
        echo -e "\n请选择要安装的游戏 [0-7]: "
        read choice
        
        if [[ "$choice" == "0" ]]; then
            exit 0
        fi
        
        run_installer $choice
    done
fi 