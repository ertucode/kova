import fs from "fs/promises";
import { GenericError, GenericResult } from "../../common/GenericError.js";
import { Result } from "../../common/Result.js";
import { errorToString } from "../../common/errorToString.js";

export type ReplaceInFileOptions = {
  filePath: string;
  searchQuery: string;
  replaceText: string;
  useRegex?: boolean;
  caseSensitive?: boolean;
  replaceAll?: boolean;
};

export type ReplaceResult = {
  filePath: string;
  replacementCount: number;
};

export async function replaceStringInFile(
  options: ReplaceInFileOptions,
): Promise<GenericResult<ReplaceResult>> {
  const {
    filePath,
    searchQuery,
    replaceText,
    useRegex = false,
    caseSensitive = false,
    replaceAll = false,
  } = options;

  try {
    // Read the file content
    const content = await fs.readFile(filePath, "utf-8");
    let newContent: string;
    let replacementCount = 0;

    if (useRegex) {
      // Use regex replacement
      const flags = caseSensitive ? (replaceAll ? "g" : "") : replaceAll ? "gi" : "i";
      const regex = new RegExp(searchQuery, flags);
      
      if (replaceAll) {
        // Count matches before replacing
        const matches = content.match(regex);
        replacementCount = matches ? matches.length : 0;
        newContent = content.replace(regex, replaceText);
      } else {
        // Replace first match only
        newContent = content.replace(regex, replaceText);
        replacementCount = newContent !== content ? 1 : 0;
      }
    } else {
      // Use literal string replacement
      const searchStr = caseSensitive ? searchQuery : searchQuery.toLowerCase();
      const contentToSearch = caseSensitive ? content : content.toLowerCase();
      
      if (replaceAll) {
        // Count occurrences
        let index = 0;
        while ((index = contentToSearch.indexOf(searchStr, index)) !== -1) {
          replacementCount++;
          index += searchStr.length;
        }
        
        // Replace all occurrences
        newContent = content;
        let lastIndex = 0;
        let result = "";
        
        while ((index = contentToSearch.indexOf(searchStr, lastIndex)) !== -1) {
          result += content.slice(lastIndex, index) + replaceText;
          lastIndex = index + searchQuery.length;
        }
        result += content.slice(lastIndex);
        newContent = result;
      } else {
        // Replace first occurrence only
        const index = contentToSearch.indexOf(searchStr);
        if (index !== -1) {
          newContent = 
            content.slice(0, index) + 
            replaceText + 
            content.slice(index + searchQuery.length);
          replacementCount = 1;
        } else {
          newContent = content;
          replacementCount = 0;
        }
      }
    }

    // Only write if changes were made
    if (replacementCount > 0) {
      await fs.writeFile(filePath, newContent, "utf-8");
    }

    return Result.Success({ filePath, replacementCount });
  } catch (error) {
    return GenericError.Message(errorToString(error));
  }
}

export type ReplaceInMultipleFilesOptions = {
  files: Array<{
    filePath: string;
    lineNumber?: number; // Optional: if provided, only replace on this line
  }>;
  searchQuery: string;
  replaceText: string;
  useRegex?: boolean;
  caseSensitive?: boolean;
};

export async function replaceStringInMultipleFiles(
  options: ReplaceInMultipleFilesOptions,
): Promise<GenericResult<ReplaceResult[]>> {
  const { files, searchQuery, replaceText, useRegex, caseSensitive } = options;

  try {
    const results: ReplaceResult[] = [];

    for (const file of files) {
      const result = await replaceStringInFile({
        filePath: file.filePath,
        searchQuery,
        replaceText,
        useRegex,
        caseSensitive,
        replaceAll: false, // Replace once per file
      });

      if (result.success) {
        results.push(result.data);
      } else {
        // If any file fails, return the error
        return result;
      }
    }

    return Result.Success(results);
  } catch (error) {
    return GenericError.Message(errorToString(error));
  }
}
