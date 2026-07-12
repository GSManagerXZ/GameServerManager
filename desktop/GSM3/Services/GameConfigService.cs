namespace GSM3.Services;

using System.Text;
using System.Text.RegularExpressions;

/// <summary>
/// Represents the metadata section of a game config schema.
/// </summary>
public class GameConfigMeta
{
    public string GameName { get; set; } = "";
    public string ConfigFile { get; set; } = "";
    public string Parser { get; set; } = "properties";
    public string? Section { get; set; }
}

/// <summary>
/// Represents a select option in a field definition.
/// </summary>
public class GameConfigOption
{
    public string Value { get; set; } = "";
    public string Label { get; set; } = "";
}

/// <summary>
/// Represents a single config field definition from the schema.
/// </summary>
public class GameConfigField
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public string Type { get; set; } = "string";
    public string Default { get; set; } = "";
    public double? Min { get; set; }
    public double? Max { get; set; }
    public double? Step { get; set; }
    public List<GameConfigOption> Options { get; set; } = new();
}

/// <summary>
/// Represents a section of config fields.
/// </summary>
public class GameConfigSection
{
    public string Name { get; set; } = "";
    public List<GameConfigField> Fields { get; set; } = new();
}

/// <summary>
/// Represents a full game config schema loaded from a YAML file.
/// </summary>
public class GameConfigSchema
{
    public GameConfigMeta Meta { get; set; } = new();
    public List<GameConfigSection> Sections { get; set; } = new();
}

/// <summary>
/// Service for loading game config YAML schemas and reading/writing actual game config files.
/// Uses a simple hand-rolled YAML parser (no NuGet dependency).
/// </summary>
public class GameConfigService
{
    private readonly string _gameConfigsDir;

    public GameConfigService()
    {
        // Look for GameConfigs directory relative to the app's base directory
        _gameConfigsDir = Path.Combine(AppContext.BaseDirectory, "GameConfigs");

        // Fallback: check if we're running from the project directory (dev scenario)
        if (!Directory.Exists(_gameConfigsDir))
        {
            var projectDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
            var devPath = Path.Combine(projectDir, "GameConfigs");
            if (Directory.Exists(devPath))
            {
                _gameConfigsDir = devPath;
            }
        }
    }

    public GameConfigService(string gameConfigsDir)
    {
        _gameConfigsDir = gameConfigsDir;
    }

    /// <summary>
    /// Lists all available YAML config schema files in the GameConfigs directory.
    /// </summary>
    public List<string> GetAvailableConfigs()
    {
        if (!Directory.Exists(_gameConfigsDir))
            return new List<string>();

        return Directory.GetFiles(_gameConfigsDir, "*.yml")
            .Concat(Directory.GetFiles(_gameConfigsDir, "*.yaml"))
            .OrderBy(f => f)
            .ToList();
    }

    /// <summary>
    /// Loads and parses a YAML schema file into a GameConfigSchema object.
    /// </summary>
    public GameConfigSchema LoadSchema(string yamlPath)
    {
        if (!File.Exists(yamlPath))
            throw new FileNotFoundException($"Schema file not found: {yamlPath}");

        var lines = File.ReadAllLines(yamlPath, Encoding.UTF8);
        return ParseYaml(lines);
    }

    /// <summary>
    /// Loads a schema by game name (searches available configs).
    /// </summary>
    public GameConfigSchema? LoadSchemaByGameName(string gameName)
    {
        foreach (var path in GetAvailableConfigs())
        {
            try
            {
                var schema = LoadSchema(path);
                if (schema.Meta.GameName.Equals(gameName, StringComparison.OrdinalIgnoreCase))
                    return schema;
            }
            catch
            {
                // Skip invalid schemas
            }
        }
        return null;
    }

    /// <summary>
    /// Reads an actual game config file using the schema to understand its format.
    /// Returns a dictionary of key -> value for all recognized fields.
    /// </summary>
    public Dictionary<string, string> ReadConfig(string configFilePath, GameConfigSchema schema)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        // Initialize with defaults from schema
        foreach (var section in schema.Sections)
        {
            foreach (var field in section.Fields)
            {
                values[field.Key] = field.Default;
            }
        }

        if (!File.Exists(configFilePath))
            return values;

        var content = File.ReadAllText(configFilePath, Encoding.UTF8);

        switch (schema.Meta.Parser.ToLowerInvariant())
        {
            case "properties":
                ParsePropertiesFile(content, values);
                break;
            case "ini":
                ParseIniFile(content, schema.Meta.Section, values);
                break;
            default:
                throw new NotSupportedException($"Unsupported parser type: {schema.Meta.Parser}");
        }

        return values;
    }

    /// <summary>
    /// Writes config values to a game config file using the schema format.
    /// </summary>
    public void SaveConfig(string configFilePath, GameConfigSchema schema, Dictionary<string, string> values)
    {
        // Ensure directory exists
        var dir = Path.GetDirectoryName(configFilePath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        switch (schema.Meta.Parser.ToLowerInvariant())
        {
            case "properties":
                WritePropertiesFile(configFilePath, schema, values);
                break;
            case "ini":
                WriteIniFile(configFilePath, schema, values);
                break;
            default:
                throw new NotSupportedException($"Unsupported parser type: {schema.Meta.Parser}");
        }
    }

    #region Properties file parser

    private void ParsePropertiesFile(string content, Dictionary<string, string> values)
    {
        var lines = content.Split('\n');
        foreach (var rawLine in lines)
        {
            var line = rawLine.TrimEnd('\r').Trim();

            // Skip comments and empty lines
            if (string.IsNullOrEmpty(line) || line.StartsWith('#') || line.StartsWith("//"))
                continue;

            var eqIndex = line.IndexOf('=');
            if (eqIndex < 0)
                continue;

            var key = line[..eqIndex].Trim();
            var value = line[(eqIndex + 1)..].Trim();

            if (values.ContainsKey(key))
            {
                values[key] = value;
            }
        }
    }

    private void WritePropertiesFile(string filePath, GameConfigSchema schema, Dictionary<string, string> values)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"# {schema.Meta.GameName} Server Configuration");
        sb.AppendLine($"# Generated by GSM3");
        sb.AppendLine();

        // If the file already exists, try to preserve comments and ordering
        if (File.Exists(filePath))
        {
            var existingLines = File.ReadAllLines(filePath, Encoding.UTF8);
            var writtenKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var rawLine in existingLines)
            {
                var line = rawLine.TrimEnd('\r');
                var trimmed = line.Trim();

                if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith('#') || trimmed.StartsWith("//"))
                {
                    sb.AppendLine(line);
                    continue;
                }

                var eqIndex = trimmed.IndexOf('=');
                if (eqIndex < 0)
                {
                    sb.AppendLine(line);
                    continue;
                }

                var key = trimmed[..eqIndex].Trim();
                if (values.TryGetValue(key, out var val))
                {
                    sb.AppendLine($"{key}={val}");
                    writtenKeys.Add(key);
                }
                else
                {
                    sb.AppendLine(line);
                    writtenKeys.Add(key);
                }
            }

            // Append any new keys not in the existing file
            foreach (var kvp in values)
            {
                if (!writtenKeys.Contains(kvp.Key))
                {
                    sb.AppendLine($"{kvp.Key}={kvp.Value}");
                }
            }
        }
        else
        {
            // Write fresh file organized by schema sections
            foreach (var section in schema.Sections)
            {
                sb.AppendLine($"# {section.Name}");
                foreach (var field in section.Fields)
                {
                    var val = values.TryGetValue(field.Key, out var v) ? v : field.Default;
                    sb.AppendLine($"{field.Key}={val}");
                }
                sb.AppendLine();
            }
        }

        File.WriteAllText(filePath, sb.ToString(), Encoding.UTF8);
    }

    #endregion

    #region INI file parser

    private void ParseIniFile(string content, string? targetSection, Dictionary<string, string> values)
    {
        var lines = content.Split('\n');
        string? currentSection = null;

        foreach (var rawLine in lines)
        {
            var line = rawLine.TrimEnd('\r').Trim();

            if (string.IsNullOrEmpty(line) || line.StartsWith(';') || line.StartsWith('#'))
                continue;

            // Section header: [SectionName]
            if (line.StartsWith('[') && line.EndsWith(']'))
            {
                currentSection = line[1..^1].Trim();
                continue;
            }

            // Only parse keys from the target section (or all if no target)
            if (targetSection != null && !string.Equals(currentSection, targetSection, StringComparison.OrdinalIgnoreCase))
                continue;

            var eqIndex = line.IndexOf('=');
            if (eqIndex < 0)
                continue;

            var key = line[..eqIndex].Trim();
            var value = line[(eqIndex + 1)..].Trim();

            // PalWorld wraps the entire value set in OptionSettings=(...)
            // Handle the special case where the value contains nested key=value pairs
            if (key == "OptionSettings" && value.StartsWith('(') && value.EndsWith(')'))
            {
                ParsePalWorldOptionSettings(value[1..^1], values);
                continue;
            }

            // Remove surrounding quotes if present
            if (value.Length >= 2 &&
                ((value.StartsWith('"') && value.EndsWith('"')) ||
                 (value.StartsWith('\'') && value.EndsWith('\''))))
            {
                value = value[1..^1];
            }

            if (values.ContainsKey(key))
            {
                values[key] = value;
            }
        }
    }

    /// <summary>
    /// PalWorld stores all settings in a single line like:
    /// OptionSettings=(ServerName="...",ServerPlayerMaxNum=32,ExpRate=1.000000,...)
    /// </summary>
    private void ParsePalWorldOptionSettings(string optionString, Dictionary<string, string> values)
    {
        // Split by commas, but respect quoted strings
        var pairs = SplitRespectingQuotes(optionString, ',');

        foreach (var pair in pairs)
        {
            var trimmed = pair.Trim();
            var eqIndex = trimmed.IndexOf('=');
            if (eqIndex < 0)
                continue;

            var key = trimmed[..eqIndex].Trim();
            var value = trimmed[(eqIndex + 1)..].Trim();

            // Remove surrounding quotes
            if (value.Length >= 2 && value.StartsWith('"') && value.EndsWith('"'))
            {
                value = value[1..^1];
            }

            if (values.ContainsKey(key))
            {
                values[key] = value;
            }
        }
    }

    private static List<string> SplitRespectingQuotes(string input, char delimiter)
    {
        var result = new List<string>();
        var current = new StringBuilder();
        bool inQuotes = false;

        foreach (char c in input)
        {
            if (c == '"')
            {
                inQuotes = !inQuotes;
                current.Append(c);
            }
            else if (c == delimiter && !inQuotes)
            {
                result.Add(current.ToString());
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        if (current.Length > 0)
            result.Add(current.ToString());

        return result;
    }

    private void WriteIniFile(string filePath, GameConfigSchema schema, Dictionary<string, string> values)
    {
        var sb = new StringBuilder();

        // Special handling for PalWorld-style INI files where all settings go in OptionSettings=(...)
        if (schema.Meta.Section != null && schema.Meta.ConfigFile.Contains("PalWorld", StringComparison.OrdinalIgnoreCase))
        {
            WritePalWorldIni(sb, schema, values);
        }
        else
        {
            WriteStandardIni(sb, schema, values);
        }

        File.WriteAllText(filePath, sb.ToString(), Encoding.UTF8);
    }

    private void WritePalWorldIni(StringBuilder sb, GameConfigSchema schema, Dictionary<string, string> values)
    {
        sb.AppendLine("; PalWorld Server Configuration");
        sb.AppendLine("; Generated by GSM3");
        sb.AppendLine();
        sb.AppendLine($"[{schema.Meta.Section}]");

        var pairs = new List<string>();
        foreach (var section in schema.Sections)
        {
            foreach (var field in section.Fields)
            {
                var val = values.TryGetValue(field.Key, out var v) ? v : field.Default;

                // Wrap string values in quotes for PalWorld format
                if (field.Type == "string")
                {
                    pairs.Add($"{field.Key}=\"{val}\"");
                }
                else if (field.Type == "boolean")
                {
                    // PalWorld uses True/False
                    var boolVal = val.Equals("true", StringComparison.OrdinalIgnoreCase) ? "True" : "False";
                    pairs.Add($"{field.Key}={boolVal}");
                }
                else if (field.Type == "number" && val.Contains('.'))
                {
                    // PalWorld uses 6-decimal float format
                    if (double.TryParse(val, System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture, out var numVal))
                    {
                        pairs.Add($"{field.Key}={numVal.ToString("F6", System.Globalization.CultureInfo.InvariantCulture)}");
                    }
                    else
                    {
                        pairs.Add($"{field.Key}={val}");
                    }
                }
                else
                {
                    pairs.Add($"{field.Key}={val}");
                }
            }
        }

        sb.AppendLine($"OptionSettings=({string.Join(",", pairs)})");
    }

    private void WriteStandardIni(StringBuilder sb, GameConfigSchema schema, Dictionary<string, string> values)
    {
        sb.AppendLine($"; {schema.Meta.GameName} Server Configuration");
        sb.AppendLine("; Generated by GSM3");
        sb.AppendLine();

        if (schema.Meta.Section != null)
        {
            sb.AppendLine($"[{schema.Meta.Section}]");
        }

        foreach (var section in schema.Sections)
        {
            sb.AppendLine($"; --- {section.Name} ---");
            foreach (var field in section.Fields)
            {
                var val = values.TryGetValue(field.Key, out var v) ? v : field.Default;
                sb.AppendLine($"{field.Key}={val}");
            }
            sb.AppendLine();
        }
    }

    #endregion

    #region Simple YAML parser

    /// <summary>
    /// Parses a YAML schema file into a GameConfigSchema.
    /// This is a minimal YAML parser that handles the specific structure of our schema files.
    /// It does NOT handle arbitrary YAML -- only the flat key-value and list structures used here.
    /// </summary>
    private GameConfigSchema ParseYaml(string[] lines)
    {
        var schema = new GameConfigSchema();
        var context = new Stack<string>();
        GameConfigSection? currentSection = null;
        GameConfigField? currentField = null;
        GameConfigOption? currentOption = null;

        for (int i = 0; i < lines.Length; i++)
        {
            var rawLine = lines[i].TrimEnd('\r');

            // Skip empty lines and comments
            if (string.IsNullOrWhiteSpace(rawLine) || rawLine.TrimStart().StartsWith('#'))
                continue;

            int indent = GetIndent(rawLine);
            var trimmed = rawLine.Trim();

            // List item indicator
            bool isList = trimmed.StartsWith("- ");
            if (isList)
                trimmed = trimmed[2..].Trim();

            // Parse key: value
            var colonIndex = trimmed.IndexOf(':');
            if (colonIndex < 0)
                continue;

            var key = trimmed[..colonIndex].Trim();
            var value = trimmed[(colonIndex + 1)..].Trim();

            // Remove surrounding quotes from value
            value = UnquoteYaml(value);

            // Determine context based on indentation level
            if (indent == 0)
            {
                // Top-level: meta or sections
                if (key == "meta")
                {
                    context.Clear();
                    context.Push("meta");
                }
                else if (key == "sections")
                {
                    context.Clear();
                    context.Push("sections");
                }
            }
            else if (context.Count > 0 && context.Peek() == "meta" && indent == 2)
            {
                // meta fields
                switch (key)
                {
                    case "game_name": schema.Meta.GameName = value; break;
                    case "config_file": schema.Meta.ConfigFile = value; break;
                    case "parser": schema.Meta.Parser = value; break;
                    case "section": schema.Meta.Section = value; break;
                }
            }
            else if (context.Count > 0 && context.Peek() == "sections" && isList && indent == 2)
            {
                // New section
                if (key == "name")
                {
                    currentSection = new GameConfigSection { Name = value };
                    schema.Sections.Add(currentSection);
                    currentField = null;
                    currentOption = null;
                }
            }
            else if (currentSection != null && indent == 4 && key == "fields")
            {
                // fields: list start -- nothing to do, children will be parsed
            }
            else if (currentSection != null && isList && indent == 6)
            {
                // New field in the current section
                if (key == "key")
                {
                    currentField = new GameConfigField { Key = value };
                    currentSection.Fields.Add(currentField);
                    currentOption = null;
                }
            }
            else if (currentField != null && indent == 8 && !isList)
            {
                // Field properties
                switch (key)
                {
                    case "label": currentField.Label = value; break;
                    case "type": currentField.Type = value; break;
                    case "default":
                        currentField.Default = value;
                        break;
                    case "min":
                        if (double.TryParse(value, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out var min))
                            currentField.Min = min;
                        break;
                    case "max":
                        if (double.TryParse(value, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out var max))
                            currentField.Max = max;
                        break;
                    case "step":
                        if (double.TryParse(value, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out var step))
                            currentField.Step = step;
                        break;
                    case "options":
                        // options: list start
                        break;
                }
            }
            else if (currentField != null && isList && indent == 10)
            {
                // New option in the current field
                if (key == "value")
                {
                    currentOption = new GameConfigOption { Value = value };
                    currentField.Options.Add(currentOption);
                }
            }
            else if (currentOption != null && indent == 12)
            {
                // Option property
                if (key == "label")
                {
                    currentOption.Label = value;
                }
            }
        }

        return schema;
    }

    private static int GetIndent(string line)
    {
        int count = 0;
        foreach (char c in line)
        {
            if (c == ' ') count++;
            else break;
        }
        return count;
    }

    private static string UnquoteYaml(string value)
    {
        if (string.IsNullOrEmpty(value))
            return value;

        if (value.Length >= 2 &&
            ((value.StartsWith('"') && value.EndsWith('"')) ||
             (value.StartsWith('\'') && value.EndsWith('\''))))
        {
            return value[1..^1];
        }

        return value;
    }

    #endregion
}
